// 驱动实例化雨滴和落地飞溅，使飞溅位置与积水遮罩保持同步。

import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import {
	createPuddleCoverageUniforms,
	patchPuddleCoverageShader,
	PUDDLE_COVERAGE_SHADER,
	type PuddleCoverageUniforms
} from './puddleCoverage';

/**
 * 降雨与飞溅移植自 Faraz-Portfolio/demo-2023-rain-puddle（GPL-3.0 许可证）。
 * 来源文件为 Drops.tsx、Splashes/index.tsx 和 Splashes/useSplashPositions.ts：
 * 来源地址：https://github.com/Faraz-Portfolio/demo-2023-rain-puddle/tree/257066b63d08b227df8f982377e60f91752ddc81/src/Rain
 * 来源与许可说明见 THIRD_PARTY_NOTICES.md 和 third_party/Faraz-rain-puddle-GPL-3.0.txt。
 */

const RAIN_START_SECONDS = 5;
/** 在碰撞体深度层之后绘制，沿用当前 3DGS 场景的透明绘制顺序。 */
const RAIN_RENDER_ORDER = 50;
/** 端视时雨丝最短比例，避免完全消失。 */
const STREAK_MIN_SCALE = 0.12;

/** 降雨与飞溅的初始化参数。 */
type RainEffectOptions = {
	/** 雨滴实例数量。 */
	count?: number;
	/** 飞溅实例数量。 */
	splashCount?: number;
	/** 飞溅的独立尺寸倍率。 */
	splashScale?: number;
	/** 飞溅序列帧贴图，由降雨效果负责释放。 */
	splashTexture: THREE.Texture;
	/** 局部空间竖直下落速度，单位为局部长度每秒。 */
	fallSpeed?: number;
	/** 局部 X/Z 方向的风速，单位为局部长度每秒。 */
	wind?: readonly [ number, number ];
};

type SplashSurface = {
	mesh: THREE.Mesh;
	geometry: THREE.BufferGeometry;
	sampler: MeshSurfaceSampler;
};

const createDropMaterial = (
	progress: THREE.IUniform<number>,
	fallDir: THREE.IUniform<THREE.Vector3>
) => {
	// 雨滴关闭色调映射，避免低曝光使白色雨丝变灰。
	const material = new THREE.MeshBasicMaterial( { transparent: true, toneMapped: false } );
	material.customProgramCacheKey = () => 'faraz-rain-drops-foreshorten';
	material.onBeforeCompile = ( shader ) => {
		shader.uniforms.uRainProgress = progress;
		shader.uniforms.uFallDir = fallDir;
		shader.uniforms.uStreakMin = { value: STREAK_MIN_SCALE };
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying vec2 vRainUv;\nvarying float vStreakScale;\nuniform vec3 uFallDir;\nuniform float uStreakMin;'
			)
			.replace( '#include <uv_vertex>', '#include <uv_vertex>\nvRainUv = uv;' )
			.replace(
				'#include <project_vertex>',
				/* glsl */ `
				#include <project_vertex>
				vec3 rainWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
				vec3 viewDir = normalize( cameraPosition - rainWorldPos );
				vec3 fallDir = normalize( uFallDir );
				// 视线与下落方向平行 → 0（应看成点）；垂直 → 1（全长雨丝）。
				vStreakScale = max( length( cross( viewDir, fallDir ) ), uStreakMin );
				`
			);
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', /* glsl */ `
				#include <common>
				uniform float uRainProgress;
				varying vec2 vRainUv;
				varying float vStreakScale;

				float sdUnevenCapsule( vec2 p, float r1, float r2, float h ) {
					p.x = abs( p.x );
					float b = ( r1 - r2 ) / h;
					float a = sqrt( 1.0 - b * b );
					float k = dot( p, vec2( -b, a ) );
					if ( k < 0.0 ) return length( p ) - r1;
					if ( k > a * h ) return length( p - vec2( 0.0, h ) ) - r2;
					return dot( p, vec2( a, b ) ) - r1;
				}
			` )
			.replace( '#include <color_fragment>', /* glsl */ `
				#include <color_fragment>
				vec2 coord = ( vRainUv - 0.5 ) * 10.0;
				// 端视时拉大纵向 UV，固定高度胶囊在画面上缩成点。
				coord.y /= vStreakScale;
				float dropletDistance = sdUnevenCapsule( coord, 0.05, 0.0, 2.0 );
				dropletDistance = 1.0 - smoothstep( 0.0, 0.05, dropletDistance );
				float rainProgress = clamp( smoothstep( 0.0, 0.5, uRainProgress ), 0.0, 1.0 );
				diffuseColor.a = dropletDistance * 0.1 * rainProgress;
			` );
	};
	return material;
};

const createSplashMaterial = (
	progress: THREE.IUniform<number>, texture: THREE.Texture, coverageUniforms: PuddleCoverageUniforms
) => {
	const material = new THREE.MeshBasicMaterial( {
		transparent: true,
		toneMapped: false,
		blending: THREE.AdditiveBlending
	} );
	material.customProgramCacheKey = () => 'faraz-rain-splashes-puddle-coverage';
	material.onBeforeCompile = ( shader ) => {
		Object.assign( shader.uniforms, coverageUniforms );
		shader.uniforms.uRainProgress = progress;
		shader.uniforms.uFlipBook = { value: texture };
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', /* glsl */ `
				#include <common>
				attribute float aSplashProgress;
				attribute vec2 aPuddlePosition;
				varying vec2 vRainUv;
				varying float vSplashProgress;
				varying float vPuddleCoverage;
				uniform float uRainProgress;
				${ PUDDLE_COVERAGE_SHADER }
			` )
			.replace( '#include <uv_vertex>', /* glsl */ `
				#include <uv_vertex>
				vRainUv = uv;
				vSplashProgress = aSplashProgress;
				vPuddleCoverage = getPuddleCoverage( aPuddlePosition, uRainProgress );
			` )
			.replace( '#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += 0.05;' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', /* glsl */ `
				#include <common>
				uniform sampler2D uFlipBook;
				uniform float uRainProgress;
				varying vec2 vRainUv;
				varying float vSplashProgress;
				varying float vPuddleCoverage;

				float mapLinear( float value, float inMin, float inMax, float outMin, float outMax ) {
					return outMin + ( outMax - outMin ) * ( ( value - inMin ) / ( inMax - inMin ) );
				}

				float fmod( float x, float y ) {
					return x - y * trunc( x / y );
				}

				vec2 getFlipbookUv( vec2 uv, float width, float height, float tile, vec2 invert ) {
					tile = fmod( tile, width * height );
					vec2 tileCount = vec2( 1.0 ) / vec2( width, height );
					float tileY = abs( invert.y * height - ( floor( tile * tileCount.x ) + invert.y * 1.0 ) );
					float tileX = abs( invert.x * width - ( ( tile - width * floor( tile * tileCount.x ) ) + invert.x * 1.0 ) );
					return ( uv + vec2( tileX, tileY ) ) * tileCount;
				}
			` )
			.replace( '#include <color_fragment>', /* glsl */ `
				#include <color_fragment>
				float progress = 1.0 - clamp( mapLinear( vSplashProgress, 0.0, 0.3, 0.0, 1.0 ), 0.0, 1.0 );
				float tiling = floor( progress * 4.0 * 5.0 );
				vec2 splashUv = getFlipbookUv( vRainUv, 4.0, 5.0, tiling, vec2( 0.0, 1.0 ) );
				vec4 texel = texture2D( uFlipBook, splashUv );
				float rainProgress = clamp( smoothstep( 0.0, 0.5, uRainProgress ), 0.0, 1.0 );
				diffuseColor.a = texel.a * 0.1 * rainProgress * vPuddleCoverage;
				if ( diffuseColor.a <= 0.0 ) discard;
			` );
		// 在飞溅平面的顶点阶段计算共享噪声，减少逐像素采样开销。
		shader.vertexShader = patchPuddleCoverageShader( shader.vertexShader );
	};
	return material;
};

/** 通过实例化平面绘制雨滴与水面飞溅，位置和缩放由场景配置提供。 */
export class RainEffect {
	/** 雨滴和飞溅的场景根节点。 */
	readonly group = new THREE.Group();
	private readonly drops: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private readonly splashes: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private readonly splashTexture: THREE.Texture;
	private readonly progress = { value: 0 };
	private readonly splashProgress: THREE.InstancedBufferAttribute;
	private readonly splashPuddlePositions: THREE.InstancedBufferAttribute;
	private readonly coverageUniforms = createPuddleCoverageUniforms();
	private readonly splashY: Float32Array;
	private readonly initialSplashY: Float32Array;
	private readonly splashPositions: Float32Array;
	private readonly dummy = new THREE.Object3D();
	private readonly cameraPosition = new THREE.Vector3();
	private readonly splashSurfaces: SplashSurface[] = [];
	private readonly dropCount: number;
	private readonly splashCount: number;
	private readonly splashScale: number;
	private fallSpeed: number;
	private readonly wind = new THREE.Vector2();
	private readonly fallDirUniform: THREE.IUniform<THREE.Vector3> = {
		value: new THREE.Vector3( 0, - 1, 0 )
	};
	private readonly fallDirLocal = new THREE.Vector3();
	private splashSurfaceRoot?: THREE.Object3D;
	private enabled = false;
	private disposed = false;

	constructor( options: RainEffectOptions ) {
		const count = Math.max( 1, Math.round( options.count ?? 1000 ) );
		this.dropCount = count;
		this.splashCount = Math.max( 1, Math.round( options.splashCount ?? 1000 ) );
		this.splashScale = Math.max( 0.001, options.splashScale ?? 1 );
		this.fallSpeed = Math.max( 0.1, options.fallSpeed ?? 2.5 );
		this.wind.set( options.wind?.[ 0 ] ?? 0, options.wind?.[ 1 ] ?? 0 );
		this.splashTexture = options.splashTexture;
		this.drops = new THREE.InstancedMesh(
			new THREE.PlaneGeometry( 0.1, 0.15 ),
			createDropMaterial( this.progress, this.fallDirUniform ),
			count
		);
		const splashGeometry = new THREE.PlaneGeometry( 0.2 * 0.2, 0.1 * 0.2 );
		this.splashProgress = new THREE.InstancedBufferAttribute( new Float32Array( this.splashCount ), 1 );
		this.splashProgress.setUsage( THREE.DynamicDrawUsage );
		splashGeometry.setAttribute( 'aSplashProgress', this.splashProgress );
		this.splashPuddlePositions = new THREE.InstancedBufferAttribute( new Float32Array( this.splashCount * 2 ), 2 );
		this.splashPuddlePositions.setUsage( THREE.DynamicDrawUsage );
		splashGeometry.setAttribute( 'aPuddlePosition', this.splashPuddlePositions );
		this.splashes = new THREE.InstancedMesh(
			splashGeometry, createSplashMaterial( this.progress, this.splashTexture, this.coverageUniforms ), this.splashCount
		);
		this.splashes.count = 0;
		this.splashY = new Float32Array( this.splashCount );
		this.initialSplashY = new Float32Array( this.splashCount );
		this.splashPositions = new Float32Array( this.splashCount * 3 );
		this.drops.name = 'RainDrops';
		this.splashes.name = 'RainSplashes';
		for ( const mesh of [ this.drops, this.splashes ] ) {
			mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
			mesh.frustumCulled = false;
			mesh.renderOrder = RAIN_RENDER_ORDER;
			mesh.userData.excludeFromCollider = true;
		}
		this.group.name = 'RainEffect';
		this.group.userData.excludeFromCollider = true;
		this.group.visible = false;
		this.group.add( this.drops, this.splashes );
		for ( let i = 0; i < count; i ++ ) {
			this.dummy.position.set(
				THREE.MathUtils.randFloatSpread( 5 ),
				THREE.MathUtils.randFloat( -0.1, 5 ),
				THREE.MathUtils.randFloatSpread( 5 )
			);
			this.dummy.updateMatrix();
			this.drops.setMatrixAt( i, this.dummy.matrix );
		}
		this.drops.instanceMatrix.needsUpdate = true;
	}

	/** 切换降雨可见性并重置五秒渐入进度。 */
	setEnabled( enabled: boolean ) {
		if ( this.enabled === enabled ) return;
		this.enabled = enabled;
		this.group.visible = enabled;
		this.progress.value = 0;
		this.drops.count = enabled ? 0 : this.dropCount;
		if ( this.splashSurfaces.length > 0 ) {
			this.splashes.count = enabled ? 0 : this.splashCount;
		}
	}

	/** 设置雨滴局部下落速度，最小为每秒 0.1 个局部单位。 */
	setFallSpeed( speed: number ) {
		this.fallSpeed = Math.max( 0.1, speed );
	}

	/** 返回雨滴局部下落速度，单位为局部长度每秒。 */
	getFallSpeed() {
		return this.fallSpeed;
	}

	/** 设置局部 X/Z 风速，单位为局部长度每秒。 */
	setWind( x: number, z: number ) {
		this.wind.set( x, z );
	}

	/** 返回风速向量对象，两个分量分别表示局部 X/Z 风速。 */
	getWind() {
		return this.wind;
	}

	/** 返回雨滴、飞溅与积水共享的 5 秒线性降雨进度参数。 */
	getRainProgress(): THREE.IUniform<number> {
		return this.progress;
	}

	/** 在积水水面网格上采样飞溅落点，并共享水面的覆盖遮罩。 */
	setSplashSurfaces( root: THREE.Object3D, coverageUniforms: PuddleCoverageUniforms ) {
		if ( this.disposed ) return;
		Object.assign( this.coverageUniforms, coverageUniforms );
		this.splashes.material.needsUpdate = true;
		this.clearSplashSurfaces();
		this.splashSurfaceRoot = root;
		root.updateWorldMatrix( true, true );
		const normalMatrix = new THREE.Matrix3();
		const normal = new THREE.Vector3();
		root.traverse( ( object ) => {
			if ( ! ( object instanceof THREE.Mesh ) || ! object.geometry.getAttribute( 'position' ) ) return;
			const geometry = object.geometry.clone();
			if ( ! geometry.getAttribute( 'normal' ) ) geometry.computeVertexNormals();
			const normals = geometry.getAttribute( 'normal' );
			const weights = new Float32Array( normals.count );
			normalMatrix.getNormalMatrix( object.matrixWorld );
			for ( let i = 0; i < normals.count; i ++ ) {
				normal.fromBufferAttribute( normals, i ).applyNormalMatrix( normalMatrix );
				weights[ i ] = normal.y >= 0 ? 1 : 0;
			}
			geometry.setAttribute( 'skyWeight', new THREE.BufferAttribute( weights, 1 ) );
			const sampler = new MeshSurfaceSampler( new THREE.Mesh( geometry ) )
				.setWeightAttribute( 'skyWeight' ).build();
			const distribution = sampler.distribution;
			if ( ! distribution || ! ( distribution[ distribution.length - 1 ] > 0 ) ) {
				geometry.dispose();
				return;
			}
			this.splashSurfaces.push( { mesh: object, geometry, sampler } );
		} );
		const ready = this.splashSurfaces.length > 0;
		this.group.updateWorldMatrix( true, false );
		if ( ready ) {
			for ( let i = 0; i < this.splashCount; i ++ ) {
				this.dummy.position.set( 0, 0, 0 );
				this.dummy.rotation.set( 0, 0, 0 );
				this.dummy.scale.setScalar( this.splashScale );
				this.respawnSplash( i );
				this.dummy.updateMatrix();
				this.splashes.setMatrixAt( i, this.dummy.matrix );
				this.splashProgress.setX( i, 1 );
			}
			this.splashes.instanceMatrix.needsUpdate = true;
			this.splashProgress.needsUpdate = true;
			this.splashPuddlePositions.needsUpdate = true;
		}
		this.splashes.count = ready ? Math.round( this.progress.value * this.splashCount ) : 0;
		this.splashes.visible = root.visible && this.splashes.count > 0;
	}

	/** 按帧间隔秒数更新雨滴运动、飞溅帧序与面向相机的姿态。 */
	update( camera: THREE.Camera, delta: number ) {
		if ( ! this.enabled || this.disposed ) return;
		const dt = Math.max( 0, Number.isFinite( delta ) ? delta : 0 );
		this.progress.value = Math.min( 1, this.progress.value + dt / RAIN_START_SECONDS );
		this.drops.count = Math.max( 0, Math.round( this.progress.value * this.dropCount ) );
		if ( this.splashSurfaces.length > 0 ) {
			this.splashes.count = Math.max( 0, Math.round( this.progress.value * this.splashCount ) );
		}
		this.group.updateWorldMatrix( true, false );
		this.syncFallDirWorld();
		camera.getWorldPosition( this.cameraPosition );
		this.group.worldToLocal( this.cameraPosition );
		for ( let i = 0; i < this.dropCount; i ++ ) {
			this.drops.getMatrixAt( i, this.dummy.matrix );
			this.dummy.matrix.decompose( this.dummy.position, this.dummy.quaternion, this.dummy.scale );
			this.dummy.position.x += this.wind.x * dt;
			this.dummy.position.z += this.wind.y * dt;
			this.dummy.position.y -= this.fallSpeed * dt;
			this.wrapDropXZ();
			if ( this.dummy.position.y <= 0 ) {
				this.dummy.position.set(
					THREE.MathUtils.randFloatSpread( 1 ),
					THREE.MathUtils.randFloat( -0.1, 2 ),
					THREE.MathUtils.randFloatSpread( 1 )
				);
				this.dummy.scale.setScalar( THREE.MathUtils.randFloat( 0.1, 0.5 ) );
			}
			this.orientDrop();
			this.dummy.updateMatrix();
			this.drops.setMatrixAt( i, this.dummy.matrix );
		}
		this.drops.instanceMatrix.needsUpdate = true;
		this.splashes.visible = Boolean( this.splashSurfaceRoot?.visible ) && this.splashes.count > 0;
		for ( const surface of this.splashSurfaces ) surface.mesh.updateWorldMatrix( true, false );
		const splashSim = this.splashSurfaces.length > 0 ? this.splashCount : 0;
		for ( let i = 0; i < splashSim; i ++ ) {
			this.splashes.getMatrixAt( i, this.dummy.matrix );
			this.dummy.matrix.decompose( this.dummy.position, this.dummy.quaternion, this.dummy.scale );
			this.splashY[ i ] -= dt * this.fallSpeed;
			if ( this.splashY[ i ] < -0.2 ) this.respawnSplash( i );
			this.syncSplashPosition( i );
			this.splashProgress.setX( i, THREE.MathUtils.mapLinear(
				this.splashY[ i ], this.initialSplashY[ i ], -0.2, 1, 0
			) );
			this.faceCamera();
			this.dummy.updateMatrix();
			this.splashes.setMatrixAt( i, this.dummy.matrix );
		}
		this.splashes.instanceMatrix.needsUpdate = true;
		this.splashProgress.needsUpdate = true;
		this.splashPuddlePositions.needsUpdate = true;
	}

	/** 释放雨滴、飞溅、采样几何与飞溅纹理，并移除场景节点。 */
	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.clearSplashSurfaces();
		for ( const mesh of [ this.drops, this.splashes ] ) {
			mesh.dispose();
			mesh.geometry.dispose();
			mesh.material.dispose();
		}
		this.splashTexture.dispose();
		this.group.removeFromParent();
	}

	private syncFallDirWorld() {
		this.fallDirLocal.set( this.wind.x, - this.fallSpeed, this.wind.y );
		if ( this.fallDirLocal.lengthSq() < 1e-8 ) {
			this.fallDirLocal.set( 0, - 1, 0 );
		}
		this.fallDirUniform.value
			.copy( this.fallDirLocal )
			.transformDirection( this.group.matrixWorld )
			.normalize();
	}

	private wrapDropXZ() {
		this.dummy.position.x = THREE.MathUtils.euclideanModulo( this.dummy.position.x + 0.5, 1 ) - 0.5;
		this.dummy.position.z = THREE.MathUtils.euclideanModulo( this.dummy.position.z + 0.5, 1 ) - 0.5;
	}

	private faceCamera() {
		this.dummy.rotation.y = Math.atan2(
			this.cameraPosition.x - this.dummy.position.x,
			this.cameraPosition.z - this.dummy.position.z
		);
	}

	/** 朝向相机，并按风速倾斜雨丝。 */
	private orientDrop() {
		this.dummy.rotation.order = 'YXZ';
		this.faceCamera();
		const horiz = this.wind.length();
		if ( horiz < 1e-4 ) {
			this.dummy.rotation.x = 0;
			this.dummy.rotation.z = 0;
			return;
		}
		const lean = Math.atan2( horiz, this.fallSpeed );
		const windAngle = Math.atan2( this.wind.x, this.wind.y );
		const relative = windAngle - this.dummy.rotation.y;
		this.dummy.rotation.x = Math.cos( relative ) * lean;
		this.dummy.rotation.z = Math.sin( relative ) * lean;
	}

	private respawnSplash( index: number ) {
		const countPerMesh = Math.ceil( this.splashCount / this.splashSurfaces.length );
		const surface = this.splashSurfaces[ Math.floor( index / countPerMesh ) ];
		surface.sampler.sample( this.dummy.position );
		this.splashPuddlePositions.setXY( index, this.dummy.position.x, this.dummy.position.y );
		this.dummy.position.toArray( this.splashPositions, index * 3 );
		this.syncSplashPosition( index );
		this.splashY[ index ] = THREE.MathUtils.randFloat( -0.1, 2 );
		this.initialSplashY[ index ] = this.splashY[ index ];
		this.dummy.scale.x = THREE.MathUtils.randFloat( 0.5, 1 ) * this.splashScale;
	}

	/** 保留落点的网格局部坐标，让已有水花立即跟随水面的位姿和尺寸。 */
	private syncSplashPosition( index: number ) {
		const countPerMesh = Math.ceil( this.splashCount / this.splashSurfaces.length );
		const surface = this.splashSurfaces[ Math.floor( index / countPerMesh ) ];
		this.dummy.position.fromArray( this.splashPositions, index * 3 ).applyMatrix4( surface.mesh.matrixWorld );
		this.group.worldToLocal( this.dummy.position );
		this.dummy.position.y -= 0.04 * this.splashScale;
	}

	private clearSplashSurfaces() {
		this.splashSurfaces.forEach( ( surface ) => surface.geometry.dispose() );
		this.splashSurfaces.length = 0;
		this.splashSurfaceRoot = undefined;
		this.splashes.count = 0;
		this.splashes.visible = false;
	}
}
