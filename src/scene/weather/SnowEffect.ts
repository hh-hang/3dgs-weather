// 在固定世界区域内模拟雪花粒子，并同步场景光照。

import * as THREE from 'three';
import { worldLen } from '../sceneScale';

const SNOW_COUNT_MAX = 60000;
/** 人物尺度 = 1 时的世界量。 */
const SNOW_POINT_SIZE = worldLen( 36 );
const SNOW_SPEED_MIN = worldLen( 1125 );
const SNOW_SPEED_SPAN = worldLen( 2250 );
const SNOW_SWAY = worldLen( 875 );
const SNOW_POINT_SIZE_MAX = worldLen( 90000 );
/** 超过参考距离后增加一次距离衰减，使雪花尺寸总计按距离平方反比缩小。 */
const SNOW_SIZE_REF_DISTANCE = worldLen( 1800 );
const SNOW_BOUNDS_HALF_MIN = worldLen( 50 );
/** 开启下雪时粒子数量线性增到默认值，与降雨进度时长一致。 */
const SNOW_START_SECONDS = 5;

/** 雪花粒子使用的环境光与太阳光参数。 */
export type SnowLightingParams = {
	/** 是否启用环境光。 */
	ambientEnabled: boolean;
	/** 环境光强度，非负值。 */
	ambientIntensity: number;
	/** 环境光颜色。 */
	ambientColor: THREE.Color;
	/** 是否启用太阳光。 */
	sunEnabled: boolean;
	/** 太阳光强度，非负值。 */
	sunIntensity: number;
	/** 太阳光颜色。 */
	sunColor: THREE.Color;
	/** 与高斯点光照共用的世界空间太阳方向向量。 */
	sunDirection: THREE.Vector3;
};

/** 生成边缘柔和、轮廓不规则的雪花贴图。 */
const createSnowflakeTexture = () => {

	const size = 128;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;

	const context = canvas.getContext( '2d' );

	if ( ! context ) {

		return new THREE.Texture();

	}

	context.clearRect( 0, 0, size, size );

	const drawBlob = ( x: number, y: number, radius: number, alpha: number ) => {

		const gradient = context.createRadialGradient( x, y, 0, x, y, radius );
		gradient.addColorStop( 0, `rgba(255, 255, 255, ${ alpha })` );
		gradient.addColorStop( 0.4, `rgba(255, 255, 255, ${ alpha * 0.45 })` );
		gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
		context.fillStyle = gradient;
		context.beginPath();
		context.arc( x, y, radius, 0, Math.PI * 2 );
		context.fill();

	};

	const center = size * 0.5;
	drawBlob( center, center, 40, 0.85 );
	drawBlob( center + 12, center - 8, 20, 0.4 );
	drawBlob( center - 14, center + 6, 16, 0.32 );
	drawBlob( center + 2, center + 16, 12, 0.22 );

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;

};

/**
 * 轻量雪粒子：固定在场景包围盒内，缓慢下落并左右飘。
 * 点精灵加雪花贴图。
 * 颜色受场景环境光 / 太阳（与 splat 光照同源）调制。
 */
export class SnowEffect {

	/** 雪花粒子的场景对象。 */
	readonly points: THREE.Points;
	private readonly positions: Float32Array;
	private readonly baseX: Float32Array;
	private readonly baseZ: Float32Array;
	private readonly velocities: Float32Array;
	private readonly phases: Float32Array;
	private readonly snowflakeTexture: THREE.Texture;
	private readonly material: THREE.ShaderMaterial;
	private halfX = 0.5;
	private halfY = 0.5;
	private halfZ = 0.5;
	private count = 0;
	private time = 0;
	private intro = 0;

	constructor() {

		this.positions = new Float32Array( SNOW_COUNT_MAX * 3 );
		this.baseX = new Float32Array( SNOW_COUNT_MAX );
		this.baseZ = new Float32Array( SNOW_COUNT_MAX );
		this.velocities = new Float32Array( SNOW_COUNT_MAX );
		this.phases = new Float32Array( SNOW_COUNT_MAX );
		this.snowflakeTexture = createSnowflakeTexture();

		const sizes = new Float32Array( SNOW_COUNT_MAX );
		const spins = new Float32Array( SNOW_COUNT_MAX );

		for ( let i = 0; i < SNOW_COUNT_MAX; i ++ ) {

			this.velocities[ i ] = SNOW_SPEED_MIN + Math.random() * SNOW_SPEED_SPAN;
			this.phases[ i ] = Math.random() * Math.PI * 2;
			sizes[ i ] = 0.55 + Math.random() * 1.1;
			spins[ i ] = Math.random() * Math.PI * 2;

		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( this.positions, 3 ) );
		geometry.setAttribute( 'aSize', new THREE.BufferAttribute( sizes, 1 ) );
		geometry.setAttribute( 'aSpin', new THREE.BufferAttribute( spins, 1 ) );
		geometry.setDrawRange( 0, this.count );

		this.material = new THREE.ShaderMaterial( {
			uniforms: {
				map: { value: this.snowflakeTexture },
				color: { value: new THREE.Color( 0xffffff ) },
				opacity: { value: 0.85 },
				size: { value: SNOW_POINT_SIZE },
				scale: { value: 500 },
				time: { value: 0 },
				glPointSizeMax: { value: SNOW_POINT_SIZE_MAX },
				sizeRefDistance: { value: SNOW_SIZE_REF_DISTANCE },
				ambOn: { value: 0 },
				ambIntensity: { value: 1 },
				ambColor: { value: new THREE.Color( 1, 1, 1 ) },
				sunOn: { value: 0 },
				sunIntensity: { value: 1 },
				sunColor: { value: new THREE.Color( 1, 1, 1 ) },
				sunDir: { value: new THREE.Vector3( 0.5, 1, 0.3 ) }
			},
			vertexShader: /* glsl */ `
				attribute float aSize;
				attribute float aSpin;
				uniform float size;
				uniform float scale;
				uniform float time;
				uniform float glPointSizeMax;
				uniform float sizeRefDistance;
				varying float vSpin;
				varying float vFade;

				void main() {
					vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
					gl_Position = projectionMatrix * mvPosition;

					float z = max( -mvPosition.z, 0.1 );
					float persp = scale / z;
					float extra = min( 1.0, sizeRefDistance / z );
					float rawSize = aSize * size * persp * extra;
					// 按投影尺寸淡出小粒子，减少远景雪花的突兀感。
					vFade = smoothstep( 1.5, 5.0, rawSize );
					if ( vFade <= 0.0 ) {
						gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
						gl_PointSize = 1.0;
					} else {
						gl_PointSize = clamp( rawSize, 1.0, glPointSizeMax );
					}
					vSpin = aSpin + time * 0.35;
				}
			`,
			fragmentShader: /* glsl */ `
				uniform sampler2D map;
				uniform vec3 color;
				uniform float opacity;
				uniform float ambOn;
				uniform float ambIntensity;
				uniform vec3 ambColor;
				uniform float sunOn;
				uniform float sunIntensity;
				uniform vec3 sunColor;
				uniform vec3 sunDir;
				varying float vSpin;
				varying float vFade;

				void main() {
					if ( vFade <= 0.0 ) {
						discard;
					}
					vec2 uv = gl_PointCoord - 0.5;
					float c = cos( vSpin );
					float s = sin( vSpin );
					uv = mat2( c, -s, s, c ) * uv;
					uv += 0.5;

					vec4 tex = texture2D( map, uv );
					float alpha = tex.a * opacity * vFade;
					if ( alpha < 0.02 ) {
						discard;
					}

					vec3 base = color * tex.rgb;

					if ( ambOn > 0.5 || sunOn > 0.5 ) {
						vec3 ambientTerm = ambOn > 0.5
							? base * ambColor * ambIntensity
							: base * 0.2;
						vec3 sunTerm = vec3( 0.0 );
						if ( sunOn > 0.5 ) {
							vec3 N = normalize( vec3( 0.0, 1.0, 0.05 ) );
							vec3 L = normalize( -sunDir );
							float ndl = 0.45 + 0.55 * max( dot( N, L ), 0.0 );
							sunTerm = base * sunColor * sunIntensity * ndl;
						}
						base = ambientTerm + sunTerm;
					}

					gl_FragColor = vec4( base, alpha );
				}
			`,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			blending: THREE.NormalBlending
		} );

		this.points = new THREE.Points( geometry, this.material );
		this.points.frustumCulled = false;
		this.points.visible = false;
		this.points.renderOrder = 51;

	}

	/** 切换雪花显示并重置五秒粒子渐入进度。 */
	setEnabled( enabled: boolean ) {

		this.points.visible = enabled;
		this.intro = 0;
		this.points.geometry.setDrawRange( 0, enabled ? 0 : this.count );

	}

	/**
	 * 把雪幕固定到世界空间包围盒。粒子在盒内飘落。
	 *
	 * @param center - 盒子中心（世界坐标）。
	 * @param size - 盒子全尺寸。
	 * @param count - 粒子数量，不超过上限。
	 */
	setBounds( center: THREE.Vector3, size: THREE.Vector3, count = this.count ) {

		this.count = Math.min( SNOW_COUNT_MAX, Math.max( 1, Math.round( count ) ) );
		this.halfX = Math.max( size.x * 0.5, SNOW_BOUNDS_HALF_MIN );
		this.halfY = Math.max( size.y * 0.5, SNOW_BOUNDS_HALF_MIN );
		this.halfZ = Math.max( size.z * 0.5, SNOW_BOUNDS_HALF_MIN );
		this.points.position.copy( center );
		this.points.geometry.setDrawRange( 0, this.count );

		for ( let i = 0; i < this.count; i ++ ) {

			this.baseX[ i ] = ( Math.random() - 0.5 ) * size.x;
			this.baseZ[ i ] = ( Math.random() - 0.5 ) * size.z;
			this.positions[ i * 3 ] = this.baseX[ i ];
			this.positions[ i * 3 + 1 ] = ( Math.random() - 0.5 ) * size.y;
			this.positions[ i * 3 + 2 ] = this.baseZ[ i ];

		}

		const attribute = this.points.geometry.getAttribute( 'position' ) as THREE.BufferAttribute;
		attribute.needsUpdate = true;

	}

	/**
	 * 同步场景与高斯点共用的光照参数到雪花着色。
	 *
	 * @param params - 环境光与太阳状态。
	 */
	setLighting( params: SnowLightingParams ) {

		const u = this.material.uniforms;
		u.ambOn.value = params.ambientEnabled ? 1 : 0;
		u.ambIntensity.value = Math.max( 0, params.ambientIntensity );
		u.ambColor.value.copy( params.ambientColor );
		u.sunOn.value = params.sunEnabled ? 1 : 0;
		u.sunIntensity.value = Math.max( 0, params.sunIntensity );
		u.sunColor.value.copy( params.sunColor );
		u.sunDir.value.copy( params.sunDirection );

	}

	/**
	 * 在固定包围盒内缓慢下落并左右飘。
	 *
	 * @param camera - 当前视角相机，只用来算点大小。
	 * @param delta - 帧间隔秒。
	 */
	update( camera: THREE.Camera, delta: number ) {

		if ( ! this.points.visible ) {

			return;

		}

		this.time += delta;
		this.intro = Math.min( 1, this.intro + delta / SNOW_START_SECONDS );
		this.points.geometry.setDrawRange( 0, Math.round( this.intro * this.count ) );
		this.material.uniforms.time.value = this.time;

		if ( camera instanceof THREE.PerspectiveCamera ) {

			const height = typeof window !== 'undefined' ? window.innerHeight : 800;
			this.material.uniforms.scale.value =
				height / ( 2 * Math.tan( THREE.MathUtils.degToRad( camera.fov * 0.5 ) ) );

		}

		const attribute = this.points.geometry.getAttribute( 'position' ) as THREE.BufferAttribute;
		const spanX = this.halfX * 2;
		const spanZ = this.halfZ * 2;

		for ( let i = 0; i < this.count; i ++ ) {

			let y = this.positions[ i * 3 + 1 ] - this.velocities[ i ] * delta;

			if ( y < - this.halfY ) {

				y = this.halfY;
				this.baseX[ i ] = ( Math.random() - 0.5 ) * spanX;
				this.baseZ[ i ] = ( Math.random() - 0.5 ) * spanZ;

			}

			const sway = Math.sin( this.time * 0.7 + this.phases[ i ] ) * SNOW_SWAY;
			this.positions[ i * 3 ] = this.baseX[ i ] + sway;
			this.positions[ i * 3 + 1 ] = y;
			this.positions[ i * 3 + 2 ] = this.baseZ[ i ] + sway * 0.45;

		}

		attribute.needsUpdate = true;

	}

	/** 释放雪花几何、着色材质与贴图。 */
	dispose() {

		this.points.geometry.dispose();
		this.material.dispose();
		this.snowflakeTexture.dispose();

	}

}
