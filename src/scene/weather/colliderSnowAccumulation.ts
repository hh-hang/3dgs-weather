// 在碰撞网格上叠加积雪，结合噪声、坡面筛选与脚印形变控制外观。

import * as THREE from 'three';
import type { SnowDeformMap } from './snowDeformMap';

const SNOW_LAYER_NAME = '__colliderSnow';
/** 叠在 3DGS 与接影层附近，透明积雪覆盖。 */
const SNOW_RENDER_ORDER = 1003;

/** 地面积雪的覆盖、材质与压痕参数。 */
export type ColliderSnowParams = {
	/** 噪声覆盖参数，范围为 0–1。 */
	coverage: number;
	/** 世界 XZ 坐标中的斑块噪声频率，越大斑块越小。 */
	scale: number;
	/** 积雪边缘在噪声值中的过渡半宽，非负值。 */
	edge: number;
	/** 积雪颜色，十六进制颜色值。 */
	color: number;
	/** 积雪表面粗糙度，范围为 0–1。 */
	roughness: number;
	/** 积雪位移厚度，世界单位。 */
	depth: number;
	/** 表面起伏的世界空间噪声频率。 */
	bumpScale: number;
	/** 表面起伏强度，范围为 0–1。 */
	bumpStrength: number;
	/** 表面平缓程度阈值，按世界法线 Y 分量的绝对值筛选，范围为 0–0.99。 */
	flatThreshold: number;
	/** 斑块噪声的二维偏移。 */
	seed: readonly [ number, number ];
	/** 形变图采样强度，范围为 0–1。 */
	deformStrength: number;
};

/** 地面积雪默认值，各字段含义见 ColliderSnowParams。 */
export const COLLIDER_SNOW_DEFAULTS: ColliderSnowParams = {
	coverage: 0.7,
	scale: 0.021,
	edge: 0.12,
	color: 0xeaf1ff,
	roughness: 0.82,
	depth: 0.08,
	bumpScale: 0.09,
	bumpStrength: 0.6,
	flatThreshold: 0.35,
	seed: [ 8.3, 2.1 ],
	deformStrength: 0.7
};

const NOISE_FUNCTIONS = /* glsl */ `
vec3 permute( vec3 x ) { return mod( ( ( x * 34.0 ) + 1.0 ) * x, 289.0 ); }
float snoise( vec2 v ) {
	const vec4 C = vec4( 0.211324865405187, 0.366025403784439,
		-0.577350269189626, 0.024390243902439 );
	vec2 i = floor( v + dot( v, C.yy ) );
	vec2 x0 = v - i + dot( i, C.xx );
	vec2 i1 = ( x0.x > x0.y ) ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 );
	vec4 x12 = x0.xyxy + C.xxzz;
	x12.xy -= i1;
	i = mod( i, 289.0 );
	vec3 p = permute( permute( i.y + vec3( 0.0, i1.y, 1.0 ) ) + i.x + vec3( 0.0, i1.x, 1.0 ) );
	vec3 m = max( 0.5 - vec3( dot( x0, x0 ), dot( x12.xy, x12.xy ), dot( x12.zw, x12.zw ) ), 0.0 );
	m = m * m;
	m = m * m;
	vec3 x = 2.0 * fract( p * C.www ) - 1.0;
	vec3 h = abs( x ) - 0.5;
	vec3 ox = floor( x + 0.5 );
	vec3 a0 = x - ox;
	m *= 1.79284291400159 - 0.85373472095314 * ( a0 * a0 + h * h );
	vec3 g;
	g.x = a0.x * x0.x + h.x * x0.y;
	g.yz = a0.yz * x12.xz + h.yz * x12.yw;
	return 130.0 * dot( m, g );
}
float fbm( vec2 p ) {
	float value = 0.0;
	float amp = 0.5;
	for ( int i = 0; i < 5; i ++ ) {
		value += amp * snoise( p );
		p *= 2.0;
		amp *= 0.5;
	}
	return value;
}
`;

const SNOW_FUNCTIONS = /* glsl */ `
uniform float uSnowScale;
uniform vec2 uSnowSeed;
uniform float uSnowCoverage;
uniform float uSnowEdge;
uniform vec3 uSnowColor;
uniform float uSnowRoughness;
uniform float uSnowDepth;
uniform float uSnowBumpScale;
uniform float uSnowBumpStrength;
uniform float uSnowFlatThreshold;
uniform sampler2D uDeformMap;
uniform vec2 uDeformOrigin;
uniform vec2 uDeformSize;
uniform vec2 uDeformTexelWorld;
uniform float uDeformStrength;

float snowDeformAt( vec2 worldXZ ) {
	vec2 uv = ( worldXZ - uDeformOrigin ) / max( uDeformSize, vec2( 1e-4 ) );
	if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) return 0.0;
	return texture2D( uDeformMap, uv ).r * uDeformStrength;
}

float snowCoverageMask( vec2 worldXZ ) {
	vec2 p = worldXZ * uSnowScale + uSnowSeed;
	float n = fbm( p ) * 0.5 + 0.5;
	float threshold = 1.0 - uSnowCoverage;
	return smoothstep( threshold - uSnowEdge, threshold + uSnowEdge, n );
}

// 此场景碰撞体朝上面的世界法线 Y 为负，用 abs 只积较平的面。
float snowUpFactor( vec3 worldNormal ) {
	float up = abs( worldNormal.y );
	float edge0 = uSnowFlatThreshold;
	float edge1 = max( edge0 + 1e-3, 1.0 );
	return smoothstep( edge0, edge1, up );
}

float snowAccumAt( vec3 worldNormal, vec2 worldXZ ) {
	return snowUpFactor( worldNormal ) * snowCoverageMask( worldXZ );
}

float snowHeightAt( vec2 worldXZ, float accum ) {
	float drift = fbm( worldXZ * uSnowBumpScale ) * 0.5 + 0.5;
	float h = accum * ( 1.0 - 0.4 * uSnowBumpStrength + 0.4 * uSnowBumpStrength * drift );
	return uSnowDepth * h;
}

vec3 snowReliefNormal( vec2 worldXZ ) {
	float e = 0.04;
	float h0 = fbm( worldXZ * uSnowBumpScale );
	float hx = fbm( worldXZ * uSnowBumpScale + vec2( e, 0.0 ) );
	float hz = fbm( worldXZ * uSnowBumpScale + vec2( 0.0, e ) );
	vec2 grad = vec2( hx - h0, hz - h0 ) / e;
	vec2 stepWorld = max( uDeformTexelWorld, vec2( 1e-4 ) );
	vec2 dx = vec2( stepWorld.x, 0.0 );
	vec2 dz = vec2( 0.0, stepWorld.y );
	vec2 deformGrad = vec2(
		( snowDeformAt( worldXZ + dx ) - snowDeformAt( worldXZ - dx ) ) / ( 2.0 * stepWorld.x ),
		( snowDeformAt( worldXZ + dz ) - snowDeformAt( worldXZ - dz ) ) / ( 2.0 * stepWorld.y )
	);
	vec2 heightGrad = grad * uSnowBumpStrength - uSnowDepth * 0.95 * deformGrad;
	return normalize( vec3( - heightGrad.x, 1.0, - heightGrad.y ) );
}
`;

const SNOW_INJECT = NOISE_FUNCTIONS + SNOW_FUNCTIONS;

type SnowUniforms = {
	uSnowScale: { value: number };
	uSnowSeed: { value: THREE.Vector2 };
	uSnowCoverage: { value: number };
	uSnowEdge: { value: number };
	uSnowColor: { value: THREE.Color };
	uSnowRoughness: { value: number };
	uSnowDepth: { value: number };
	uSnowBumpScale: { value: number };
	uSnowBumpStrength: { value: number };
	uSnowFlatThreshold: { value: number };
	uDeformMap: { value: THREE.Texture };
	uDeformOrigin: { value: THREE.Vector2 };
	uDeformSize: { value: THREE.Vector2 };
	uDeformTexelWorld: { value: THREE.Vector2 };
	uDeformStrength: { value: number };
};

const createEmptyDeformTexture = () => {

	const data = new Uint8Array( [ 0, 0, 0, 255 ] );
	const texture = new THREE.DataTexture( data, 1, 1, THREE.RGBAFormat );
	texture.needsUpdate = true;
	return texture;

};

/** 碰撞网格积雪覆盖层：FBM 着色 + 朝上门控 + 可选脚印形变图。 */
export class ColliderSnowAccumulation {

	/** 与碰撞体对齐的积雪覆盖节点。 */
	readonly group: THREE.Group;
	private readonly material: THREE.MeshStandardMaterial;
	private readonly snowUniforms: SnowUniforms;
	private readonly params: ColliderSnowParams;
	private readonly emptyDeformTexture = createEmptyDeformTexture();
	private intro = 0;
	private introEnabled = false;

	constructor( root: THREE.Object3D, params: Partial<ColliderSnowParams> = {} ) {

		this.params = { ...COLLIDER_SNOW_DEFAULTS, ...params };
		this.snowUniforms = {
			uSnowScale: { value: this.params.scale },
			uSnowSeed: { value: new THREE.Vector2( ...this.params.seed ) },
			uSnowCoverage: { value: 0 },
			uSnowEdge: { value: this.params.edge },
			uSnowColor: { value: new THREE.Color( this.params.color ) },
			uSnowRoughness: { value: this.params.roughness },
			uSnowDepth: { value: this.params.depth },
			uSnowBumpScale: { value: this.params.bumpScale },
			uSnowBumpStrength: { value: this.params.bumpStrength },
			uSnowFlatThreshold: { value: this.params.flatThreshold },
			uDeformMap: { value: this.emptyDeformTexture },
			uDeformOrigin: { value: new THREE.Vector2( 0, 0 ) },
			uDeformSize: { value: new THREE.Vector2( 1, 1 ) },
			uDeformTexelWorld: { value: new THREE.Vector2( 1, 1 ) },
			uDeformStrength: { value: this.params.deformStrength }
		};

		this.material = new THREE.MeshStandardMaterial( {
			color: 0xffffff,
			roughness: this.params.roughness,
			metalness: 0,
			emissive: new THREE.Color( this.params.color ),
			emissiveIntensity: 0.35,
			transparent: true,
			opacity: 1,
			depthWrite: false,
			depthTest: true,
			side: THREE.DoubleSide,
			forceSinglePass: true,
			polygonOffset: true,
			polygonOffsetFactor: - 4,
			polygonOffsetUnits: - 4
		} );
		this.material.customProgramCacheKey = () => 'collider-snow';
		this.material.onBeforeCompile = ( shader ) => {

			Object.assign( shader.uniforms, this.snowUniforms );

			shader.vertexShader = shader.vertexShader
				.replace(
					'#include <common>',
					'#include <common>\nvarying vec3 vSnowWorldPosition;\nvarying vec3 vSnowWorldNormal;\n' + SNOW_INJECT
				)
				.replace(
					'#include <begin_vertex>',
					`#include <begin_vertex>
					vec4 snowWorld = modelMatrix * vec4( transformed, 1.0 );
					vSnowWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
					float deform = clamp( snowDeformAt( snowWorld.xz ), 0.0, 1.0 );
					float baseAccum = snowAccumAt( vSnowWorldNormal, snowWorld.xz );
					float snowH = snowHeightAt( snowWorld.xz, baseAccum ) * mix( 1.0, 0.05, deform );
					snowWorld.y += snowH;
					transformed = ( inverse( modelMatrix ) * snowWorld ).xyz;
					vSnowWorldPosition = snowWorld.xyz;`
				);

			shader.fragmentShader = shader.fragmentShader
				.replace(
					'#include <common>',
					'#include <common>\nvarying vec3 vSnowWorldPosition;\nvarying vec3 vSnowWorldNormal;\n' + SNOW_INJECT
				)
				.replace(
					'#include <map_fragment>',
					`#include <map_fragment>
					// 按像素采样脚印，低面数碰撞网格也能保留完整鞋底轮廓。
					float snowDeform = clamp( snowDeformAt( vSnowWorldPosition.xz ), 0.0, 1.0 );
					float snowAccum = snowAccumAt( normalize( vSnowWorldNormal ), vSnowWorldPosition.xz )
						* mix( 1.0, 0.5, snowDeform );
					float snowShade = 0.85 + 0.15 * ( fbm( vSnowWorldPosition.xz * uSnowBumpScale * 2.0 ) * 0.5 + 0.5 );
					// 压实雪：明显变暗，但仍是雪色而非透出地面。
					vec3 packedSnow = uSnowColor * snowShade * vec3( 0.72, 0.76, 0.82 );
					diffuseColor.rgb = mix( uSnowColor * snowShade, packedSnow, snowDeform );
					diffuseColor.a *= snowAccum;`
				)
				.replace(
					'#include <emissivemap_fragment>',
					`#include <emissivemap_fragment>
					totalEmissiveRadiance *= snowAccum * mix( 1.0, 0.7, snowDeform );`
				)
				.replace(
					'#include <roughnessmap_fragment>',
					`#include <roughnessmap_fragment>
					roughnessFactor = mix( roughnessFactor, uSnowRoughness, snowAccum );`
				)
				.replace(
					'#include <normal_fragment_maps>',
					`#include <normal_fragment_maps>
					vec3 sN = snowReliefNormal( vSnowWorldPosition.xz );
					vec3 sView = normalize( ( viewMatrix * vec4( sN, 0.0 ) ).xyz );
					normal = normalize( mix( normal, sView, snowAccum ) );`
				);

		};

		this.group = new THREE.Group();
		this.group.name = SNOW_LAYER_NAME;
		root.updateWorldMatrix( true, true );
		const rootInverse = new THREE.Matrix4().copy( root.matrixWorld ).invert();
		const local = new THREE.Matrix4();

		root.traverse( ( object ) => {

			if ( ! ( object instanceof THREE.Mesh ) || object.name === SNOW_LAYER_NAME ) {

				return;

			}

			const geometry = object.geometry;
			if ( ! geometry.getAttribute( 'position' ) ) {

				return;

			}

			if ( ! geometry.getAttribute( 'normal' ) ) {

				geometry.computeVertexNormals();

			}

			const mesh = new THREE.Mesh( geometry, this.material );
			mesh.name = SNOW_LAYER_NAME;
			local.copy( object.matrixWorld ).premultiply( rootInverse );
			local.decompose( mesh.position, mesh.quaternion, mesh.scale );
			mesh.renderOrder = SNOW_RENDER_ORDER;
			mesh.frustumCulled = false;
			mesh.castShadow = false;
			mesh.receiveShadow = true;
			mesh.raycast = () => {};
			mesh.userData.excludeFromCollider = true;
			this.group.add( mesh );

		} );

		this.group.position.copy( root.position );
		this.group.quaternion.copy( root.quaternion );
		this.group.scale.copy( root.scale );
		this.group.visible = false;

	}

	/** 切换地面积雪显示并重置五秒渐入进度。 */
	setEnabled( enabled: boolean ) {

		this.introEnabled = enabled;
		this.group.visible = enabled;
		this.intro = 0;
		this.syncCoverageUniform();

	}

	/** 按帧间隔秒数推进积雪覆盖的五秒渐入。 */
	update( delta: number ) {

		if ( ! this.introEnabled ) {

			return;

		}

		this.intro = Math.min( 1, this.intro + Math.max( 0, delta ) / 5 );
		this.syncCoverageUniform();

	}

	private syncCoverageUniform() {

		this.snowUniforms.uSnowCoverage.value = this.params.coverage * this.intro;

	}

	/** 绑定形变纹理及世界覆盖范围；null 表示关闭压痕采样。 */
	setDeformMap( map: SnowDeformMap | null ) {

		if ( ! map ) {

			this.snowUniforms.uDeformMap.value = this.emptyDeformTexture;
			this.snowUniforms.uDeformStrength.value = 0;
			return;

		}

		this.snowUniforms.uDeformMap.value = map.texture;
		this.snowUniforms.uDeformOrigin.value.set( map.originX, map.originZ );
		this.snowUniforms.uDeformSize.value.set( map.sizeX, map.sizeZ );
		this.snowUniforms.uDeformTexelWorld.value.set( map.texelSizeX, map.texelSizeZ );
		this.snowUniforms.uDeformStrength.value = this.params.deformStrength;

	}

	/** 设置积雪覆盖参数并限制在 0–1。 */
	setCoverage( value: number ) {

		this.params.coverage = THREE.MathUtils.clamp( value, 0, 1 );
		this.syncCoverageUniform();

	}

	/** 设置世界空间斑块噪声频率，最小为 0.00001。 */
	setScale( value: number ) {

		this.params.scale = Math.max( value, 1e-5 );
		this.snowUniforms.uSnowScale.value = this.params.scale;

	}

	/** 设置非负的积雪边缘过渡半宽。 */
	setEdge( value: number ) {

		this.params.edge = Math.max( value, 0 );
		this.snowUniforms.uSnowEdge.value = this.params.edge;

	}

	/** 设置非负的积雪厚度，世界单位。 */
	setDepth( value: number ) {

		this.params.depth = Math.max( value, 0 );
		this.snowUniforms.uSnowDepth.value = this.params.depth;

	}

	/** 设置非负的表面起伏噪声频率。 */
	setBumpScale( value: number ) {

		this.params.bumpScale = Math.max( value, 0 );
		this.snowUniforms.uSnowBumpScale.value = this.params.bumpScale;

	}

	/** 设置表面起伏强度并限制在 0–1。 */
	setBumpStrength( value: number ) {

		this.params.bumpStrength = THREE.MathUtils.clamp( value, 0, 1 );
		this.snowUniforms.uSnowBumpStrength.value = this.params.bumpStrength;

	}

	/** 设置积雪粗糙度并限制在 0–1。 */
	setRoughness( value: number ) {

		this.params.roughness = THREE.MathUtils.clamp( value, 0, 1 );
		this.snowUniforms.uSnowRoughness.value = this.params.roughness;
		this.material.roughness = this.params.roughness;

	}

	/** 设置表面平缓程度阈值并限制在 0–0.99。 */
	setFlatThreshold( value: number ) {

		this.params.flatThreshold = THREE.MathUtils.clamp( value, 0, 0.99 );
		this.snowUniforms.uSnowFlatThreshold.value = this.params.flatThreshold;

	}

	/** 设置压痕采样强度并限制在 0–1。 */
	setDeformStrength( value: number ) {

		this.params.deformStrength = THREE.MathUtils.clamp( value, 0, 1 );
		this.snowUniforms.uDeformStrength.value = this.params.deformStrength;

	}

	/** 返回当前积雪参数对象，供调试面板读取。 */
	getParams(): Readonly<ColliderSnowParams> {

		return this.params;

	}

	/** 返回积雪渐入进度，范围为 0–1。 */
	getIntro() {

		return this.intro;

	}

	/** 移除积雪节点并释放材质和空形变纹理，保留碰撞体共享几何。 */
	dispose() {

		this.group.removeFromParent();
		this.material.dispose();
		this.emptyDeformTexture.dispose();

	}

}
