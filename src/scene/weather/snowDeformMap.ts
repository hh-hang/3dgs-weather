// 通过单通道双缓冲高度图累积脚印和车辙压痕。

import * as THREE from 'three';

/** 圆形和鞋底笔刷共享的世界位置与强度。 */
type StampBase = {
	/** 笔刷中心的世界 X 坐标。 */
	x: number;
	/** 笔刷中心的世界 Z 坐标。 */
	z: number;
	/** 压痕强度，范围为 0–1。 */
	strength: number;
};

/** 形变笔刷参数，支持圆形车辙与带四角接触权重的鞋底压痕。 */
export type SnowDeformStamp = StampBase & ( {
	/** 圆形车辙笔刷类型；省略时同样使用圆形笔刷。 */
	kind?: 'circle';
	/** 圆形笔刷半径，世界单位。 */
	radius: number;
} | {
	/** 鞋底压痕笔刷类型。 */
	kind: 'footprint';
	/** 鞋底半宽在世界 XZ 平面中的投影向量。 */
	halfWidth: readonly [ number, number ];
	/** 鞋底半长在世界 XZ 平面中的投影向量。 */
	halfLength: readonly [ number, number ];
	/** 鞋底四角接触权重，顺序为后跟左、后跟右、脚尖左、脚尖右。 */
	weights: readonly [ number, number, number, number ];
} );

/** 积雪形变图的世界覆盖范围、分辨率与衰减参数。 */
export type SnowDeformMapOptions = {
	/** 覆盖区域的世界中心，使用 X/Z 分量。 */
	center: readonly [ number, number, number ];
	/** 覆盖区域的世界全尺寸，使用 X/Z 分量。 */
	size: readonly [ number, number, number ];
	/** 形变图单边像素数。 */
	resolution?: number;
	/** 每秒衰减系数；0 表示压痕持久保留。 */
	fadePerSecond?: number;
};

/**
 * 积雪形变高度图：正交俯视 RenderTarget，软笔刷叠加脚印 / 车辙。
 * R 通道 0–1 表示下压量；不改碰撞几何与 3DGS。
 */
export class SnowDeformMap {

	/** 覆盖区域左边界的世界 X 坐标。 */
	readonly originX: number;
	/** 覆盖区域下边界的世界 Z 坐标。 */
	readonly originZ: number;
	/** 覆盖区域沿世界 X 轴的全尺寸。 */
	readonly sizeX: number;
	/** 覆盖区域沿世界 Z 轴的全尺寸。 */
	readonly sizeZ: number;
	/** 单个纹素沿 X 方向覆盖的世界长度。 */
	readonly texelSizeX: number;
	/** 单个纹素沿 Z 方向覆盖的世界长度。 */
	readonly texelSizeZ: number;

	private readonly resolution: number;
	private readonly fadePerSecond: number;
	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.OrthographicCamera;
	private readonly stampMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private readonly copyMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private readTarget: THREE.WebGLRenderTarget;
	private writeTarget: THREE.WebGLRenderTarget;
	private readonly stamps: SnowDeformStamp[] = [];
	private initialized = false;

	constructor( options: SnowDeformMapOptions ) {

		this.resolution = options.resolution ?? 1024;
		this.fadePerSecond = Math.max( options.fadePerSecond ?? 0, 0 );
		this.sizeX = Math.max( options.size[ 0 ], 1 );
		this.sizeZ = Math.max( options.size[ 2 ], 1 );
		this.originX = options.center[ 0 ] - this.sizeX * 0.5;
		this.originZ = options.center[ 2 ] - this.sizeZ * 0.5;
		this.texelSizeX = this.sizeX / this.resolution;
		this.texelSizeZ = this.sizeZ / this.resolution;

		const makeTarget = () => new THREE.WebGLRenderTarget( this.resolution, this.resolution, {
			type: THREE.HalfFloatType,
			// 只采样 R：4096 的双缓冲约 64 MiB，避免使用四通道占用 256 MiB。
			format: THREE.RedFormat,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: false,
			stencilBuffer: false
		} );
		this.readTarget = makeTarget();
		this.writeTarget = makeTarget();

		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

		this.copyMesh = new THREE.Mesh(
			new THREE.PlaneGeometry( 2, 2 ),
			new THREE.ShaderMaterial( {
				uniforms: {
					tPrev: { value: null as THREE.Texture | null },
					uFade: { value: 1 }
				},
				vertexShader: /* glsl */ `
					varying vec2 vUv;
					void main() {
						vUv = uv;
						gl_Position = vec4( position.xy, 0.0, 1.0 );
					}
				`,
				fragmentShader: /* glsl */ `
					uniform sampler2D tPrev;
					uniform float uFade;
					varying vec2 vUv;
					void main() {
						gl_FragColor = texture2D( tPrev, vUv ) * uFade;
					}
				`,
				depthTest: false,
				depthWrite: false
			} )
		);

		this.stampMesh = new THREE.Mesh(
			new THREE.PlaneGeometry( 2, 2 ),
			new THREE.ShaderMaterial( {
				uniforms: {
					uCenter: { value: new THREE.Vector2() },
					uExtent: { value: new THREE.Vector2() },
					uWorldSize: { value: new THREE.Vector2( this.sizeX, this.sizeZ ) },
					uBasisInv: { value: new THREE.Vector4() },
					uFootprint: { value: 0 },
					uContactWeights: { value: new THREE.Vector4( 1, 1, 1, 1 ) },
					uStrength: { value: 0.5 }
				},
				vertexShader: /* glsl */ `
					uniform vec2 uCenter;
					uniform vec2 uExtent;
					varying vec2 vUv;
					void main() {
						// 只绘制笔刷包围矩形，鞋底盖印无需填充整张形变图。
						vUv = uCenter + position.xy * uExtent;
						gl_Position = vec4( vUv * 2.0 - 1.0, 0.0, 1.0 );
					}
				`,
				fragmentShader: /* glsl */ `
					uniform vec2 uCenter;
					uniform vec2 uWorldSize;
					uniform vec4 uBasisInv;
					uniform float uFootprint;
					uniform vec4 uContactWeights;
					uniform float uStrength;
					varying vec2 vUv;
					void main() {
						vec2 offset = ( vUv - uCenter ) * uWorldSize;
						vec2 p = vec2( dot( uBasisInv.xy, offset ), dot( uBasisInv.zw, offset ) );
						float brush;
						if ( uFootprint > 0.5 ) {
							vec2 q = abs( p ) - vec2( 0.84 );
							float d = length( max( q, vec2( 0.0 ) ) ) + min( max( q.x, q.y ), 0.0 ) - 0.16;
							brush = 1.0 - smoothstep( -0.18, 0.0, d );
							vec2 f = clamp( p * 0.5 + 0.5, 0.0, 1.0 );
							float heel = mix( uContactWeights.y, uContactWeights.x, f.x );
							float toe = mix( uContactWeights.w, uContactWeights.z, f.x );
							brush *= mix( heel, toe, f.y );
						} else {
							brush = 1.0 - smoothstep( 0.2, 1.0, length( p ) );
						}
						if ( brush <= 0.0 ) discard;
						brush = pow( max( brush, 0.0 ), 1.15 ) * uStrength;
						gl_FragColor = vec4( brush, brush, brush, 1.0 );
					}
				`,
				transparent: true,
				blending: THREE.CustomBlending,
				blendEquation: THREE.MaxEquation,
				blendSrc: THREE.OneFactor,
				blendDst: THREE.OneFactor,
				depthTest: false,
				depthWrite: false
			} )
		);
		this.stampMesh.frustumCulled = false;

	}

	/** 当前读取缓冲的形变纹理；双缓冲交换后需重新获取。 */
	get texture(): THREE.Texture {

		return this.readTarget.texture;

	}

	/** 世界 XZ → 形变图 UV。 */
	worldToUv( x: number, z: number, out = new THREE.Vector2() ) {

		return out.set(
			( x - this.originX ) / this.sizeX,
			( z - this.originZ ) / this.sizeZ
		);

	}

	/** 将有效且与覆盖区域相交的笔刷加入待绘制队列。 */
	queueStamp( stamp: SnowDeformStamp ) {

		if ( ! Number.isFinite( stamp.x ) || ! Number.isFinite( stamp.z )
			|| ! Number.isFinite( stamp.strength ) || stamp.strength <= 0 ) return;
		const extentX = stamp.kind === 'footprint'
			? Math.abs( stamp.halfWidth[ 0 ] ) + Math.abs( stamp.halfLength[ 0 ] ) : stamp.radius;
		const extentZ = stamp.kind === 'footprint'
			? Math.abs( stamp.halfWidth[ 1 ] ) + Math.abs( stamp.halfLength[ 1 ] ) : stamp.radius;
		if ( ! Number.isFinite( extentX ) || ! Number.isFinite( extentZ ) || extentX <= 0 || extentZ <= 0 ) return;
		const uv = this.worldToUv( stamp.x, stamp.z );
		if ( uv.x < - extentX / this.sizeX || uv.x > 1 + extentX / this.sizeX
			|| uv.y < - extentZ / this.sizeZ || uv.y > 1 + extentZ / this.sizeZ ) {

			return;

		}

		this.stamps.push( stamp );

	}

	/** 清空双缓冲压痕和待绘制笔刷。 */
	clear( renderer: THREE.WebGLRenderer ) {

		this.clearTargets( renderer );
		this.stamps.length = 0;

	}

	private clearTargets( renderer: THREE.WebGLRenderer ) {
		const previousTarget = renderer.getRenderTarget();
		const previousColor = renderer.getClearColor( new THREE.Color() );
		const previousAlpha = renderer.getClearAlpha();
		try {
			renderer.setClearColor( 0x000000, 1 );
			for ( const target of [ this.readTarget, this.writeTarget ] ) {
				renderer.setRenderTarget( target );
				renderer.clear( true, false, false );
			}
			this.initialized = true;
		} finally {
			renderer.setRenderTarget( previousTarget );
			renderer.setClearColor( previousColor, previousAlpha );
		}
	}

	/** 复制并衰减上一帧压痕，叠加待处理笔刷后交换读写缓冲；帧间隔以秒计。 */
	update( renderer: THREE.WebGLRenderer, delta: number ) {

		if ( ! this.initialized ) this.clearTargets( renderer );
		if ( this.stamps.length === 0 && this.fadePerSecond <= 0 ) {

			return;

		}

		const previousTarget = renderer.getRenderTarget();
		const previousAutoClear = renderer.autoClear;
		const previousXr = renderer.xr.enabled;
		const previousColor = renderer.getClearColor( new THREE.Color() );
		const previousAlpha = renderer.getClearAlpha();
		renderer.xr.enabled = false;
		renderer.autoClear = false;

		try {
			const fade = this.fadePerSecond > 0
				? Math.max( 0, 1 - this.fadePerSecond * delta )
				: 1;

			// 复制上一帧压痕并应用衰减。
			this.scene.clear();
			this.copyMesh.material.uniforms.tPrev.value = this.readTarget.texture;
			this.copyMesh.material.uniforms.uFade.value = fade;
			this.scene.add( this.copyMesh );
			renderer.setRenderTarget( this.writeTarget );
			renderer.setClearColor( 0x000000, 1 );
			renderer.clear();
			renderer.render( this.scene, this.camera );

			// 以最大值混合叠加笔刷，保留较深压痕。
			if ( this.stamps.length > 0 ) {
				this.scene.clear();
				this.scene.add( this.stampMesh );
				const u = this.stampMesh.material.uniforms;
				for ( let i = 0; i < this.stamps.length; i ++ ) {
					const stamp = this.stamps[ i ];
					const uv = this.worldToUv( stamp.x, stamp.z );
					u.uCenter.value.copy( uv );
					if ( stamp.kind === 'footprint' ) {
						const [ wx, wz ] = stamp.halfWidth;
						const [ lx, lz ] = stamp.halfLength;
						const determinant = wx * lz - wz * lx;
						if ( ! Number.isFinite( determinant ) || Math.abs( determinant ) < 1e-8 ) continue;
						u.uBasisInv.value.set( lz, - lx, - wz, wx ).divideScalar( determinant );
						u.uExtent.value.set( ( Math.abs( wx ) + Math.abs( lx ) ) / this.sizeX,
							( Math.abs( wz ) + Math.abs( lz ) ) / this.sizeZ );
						u.uContactWeights.value.fromArray( stamp.weights );
						u.uFootprint.value = 1;
					} else {
						const radius = Math.max( stamp.radius, 1e-4 );
						u.uBasisInv.value.set( 1 / radius, 0, 0, 1 / radius );
						u.uExtent.value.set( radius / this.sizeX, radius / this.sizeZ );
						u.uFootprint.value = 0;
					}
					u.uStrength.value = THREE.MathUtils.clamp( stamp.strength, 0, 1 );
					renderer.render( this.scene, this.camera );
				}
				this.stamps.length = 0;
			}

			const swap = this.readTarget;
			this.readTarget = this.writeTarget;
			this.writeTarget = swap;
		} finally {
			renderer.setRenderTarget( previousTarget );
			renderer.autoClear = previousAutoClear;
			renderer.xr.enabled = previousXr;
			renderer.setClearColor( previousColor, previousAlpha );
		}

	}

	/** 释放双缓冲渲染目标以及复制和笔刷资源。 */
	dispose() {

		this.readTarget.dispose();
		this.writeTarget.dispose();
		this.copyMesh.geometry.dispose();
		this.copyMesh.material.dispose();
		this.stampMesh.geometry.dispose();
		this.stampMesh.material.dispose();

	}

}
