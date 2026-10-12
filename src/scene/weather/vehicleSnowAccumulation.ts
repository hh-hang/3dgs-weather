// 向车身材质注入积雪着色和位移，使积雪图案随车辆移动。

import * as THREE from 'three';

/** 车身积雪的覆盖、位移与材质参数。 */

export type VehicleSnowParams = {
	/** 噪声覆盖参数，范围为 0–1。 */
	coverage: number;
	/** 车辆局部 XZ 坐标中的斑块噪声频率。 */
	scale: number;
	/** 积雪边缘在噪声值中的过渡半宽，非负值。 */
	edge: number;
	/** 积雪位移厚度，世界单位；按网格缩放校正。 */
	thickness: number;
	/** 朝上表面的法线 Y 分量阈值，范围为 0–0.99。 */
	flatThreshold: number;
	/** 积雪颜色，十六进制颜色值。 */
	color: number;
	/** 积雪表面粗糙度，范围为 0–1。 */
	roughness: number;
	/** 车辆局部坐标中的表面起伏频率。 */
	bumpScale: number;
	/** 表面起伏强度，非负值。 */
	bumpStrength: number;
	/** 斑块噪声的二维偏移。 */
	seed: readonly [ number, number ];
};

/** 车辆积雪默认值，各字段含义见 VehicleSnowParams。 */
export const VEHICLE_SNOW_DEFAULTS: VehicleSnowParams = {
	coverage: 0.7,
	scale: 0.9,
	edge: 0.15,
	thickness: 0.06,
	flatThreshold: 0.35,
	color: 0xeaf1ff,
	roughness: 0.85,
	bumpScale: 3.0,
	bumpStrength: 0.4,
	seed: [ 3.0, 7.0 ]
};

const SKIP_MESH = /wheel|tire|rim|brake|headlight|taillight|glow|beam|volume|sprite|light/i;

type SnowUniforms = {
	uModelInv: { value: THREE.Matrix4 };
	uSnowSeed: { value: THREE.Vector2 };
	uSnowScale: { value: number };
	uSnowCoverage: { value: number };
	uSnowEdge: { value: number };
	uSnowThickness: { value: number };
	uSnowFlatThreshold: { value: number };
	uSnowColor: { value: THREE.Color };
	uSnowRoughness: { value: number };
	uSnowBump: { value: number };
	uSnowBumpScale: { value: number };
};

const SNOW_GLSL = /* glsl */ `
varying vec3 vWorldNormalW;
varying vec3 vModelPosW;
uniform mat4  uModelInv;
uniform vec2  uSnowSeed;
uniform float uSnowScale;
uniform float uSnowCoverage;
uniform float uSnowEdge;
uniform float uSnowThickness;
uniform float uSnowFlatThreshold;
uniform vec3  uSnowColor;
uniform float uSnowRoughness;
uniform float uSnowBump;
uniform float uSnowBumpScale;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
	const vec4 C = vec4(0.211324865405187, 0.366025403784439,
		-0.577350269189626, 0.024390243902439);
	vec2 i  = floor(v + dot(v, C.yy));
	vec2 x0 = v -   i + dot(i, C.xx);
	vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
	vec4 x12 = x0.xyxy + C.xxzz;
	x12.xy -= i1;
	i = mod(i, 289.0);
	vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
	vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
	m = m * m; m = m * m;
	vec3 x = 2.0 * fract(p * C.www) - 1.0;
	vec3 h = abs(x) - 0.5;
	vec3 ox = floor(x + 0.5);
	vec3 a0 = x - ox;
	m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
	vec3 g;
	g.x  = a0.x * x0.x + h.x * x0.y;
	g.yz = a0.yz * x12.xz + h.yz * x12.yw;
	return 130.0 * dot(m, g);
}
float fbm(vec2 p) {
	float value = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 5; i++) { value += amp * snoise(p); p *= 2.0; amp *= 0.5; }
	return value;
}

float snowCoverageMask(vec2 modelXZ) {
	float n = fbm(modelXZ * uSnowScale + uSnowSeed) * 0.5 + 0.5;
	float threshold = 1.0 - uSnowCoverage;
	return smoothstep(threshold - uSnowEdge, threshold + uSnowEdge, n);
}

float snowAccumAt(vec3 worldNormal, vec2 modelXZ) {
	float up = clamp(worldNormal.y, 0.0, 1.0);
	float top = smoothstep(uSnowFlatThreshold, 1.0, up);
	return top * snowCoverageMask(modelXZ);
}

vec3 snowReliefNormal(vec2 modelXZ) {
	float e = 0.04;
	float h0 = fbm(modelXZ * uSnowBumpScale);
	float hx = fbm(modelXZ * uSnowBumpScale + vec2(e, 0.0));
	float hz = fbm(modelXZ * uSnowBumpScale + vec2(0.0, e));
	vec2 grad = vec2(hx - h0, hz - h0) / e;
	return normalize(vec3(-grad.x * uSnowBump, 1.0, -grad.y * uSnowBump));
}
`;

const shouldSkipMesh = ( mesh: THREE.Mesh ) => {

	if ( mesh.userData.excludeFromCollider ) {

		return true;

	}

	if ( SKIP_MESH.test( mesh.name ) ) {

		return true;

	}

	return SKIP_MESH.test( mesh.parent?.name ?? '' );

};

/** 为车身材质注入积雪覆盖与位移，排除轮胎、灯具和辅助网格。 */
export class VehicleSnowAccumulation {

	private readonly root: THREE.Object3D;
	private readonly params: VehicleSnowParams;
	private readonly uniforms: SnowUniforms;
	private readonly processed = new Set<THREE.Material>();
	private intro = 0;
	private introEnabled = false;

	constructor( root: THREE.Object3D, params: Partial<VehicleSnowParams> = {} ) {

		this.root = root;
		this.params = { ...VEHICLE_SNOW_DEFAULTS, ...params };
		this.uniforms = {
			uModelInv: { value: new THREE.Matrix4() },
			uSnowSeed: { value: new THREE.Vector2( ...this.params.seed ) },
			uSnowScale: { value: this.params.scale },
			uSnowCoverage: { value: 0 },
			uSnowEdge: { value: this.params.edge },
			uSnowThickness: { value: this.params.thickness },
			uSnowFlatThreshold: { value: this.params.flatThreshold },
			uSnowColor: { value: new THREE.Color( this.params.color ) },
			uSnowRoughness: { value: this.params.roughness },
			uSnowBump: { value: this.params.bumpStrength },
			uSnowBumpScale: { value: this.params.bumpScale }
		};

		root.traverse( ( object ) => {

			if ( ! ( object instanceof THREE.Mesh ) || shouldSkipMesh( object ) ) {

				return;

			}

			const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
			for ( let i = 0; i < materials.length; i ++ ) {

				this.makeSnowy( materials[ i ] );

			}

		} );

		this.refreshMatrix();

	}

	private makeSnowy( material: THREE.Material | undefined ) {

		if ( ! material || this.processed.has( material ) ) {

			return;

		}

		this.processed.add( material );
		const previousCompile = material.onBeforeCompile.bind( material );
		const previousKey = material.customProgramCacheKey?.bind( material );

		material.onBeforeCompile = ( shader, renderer ) => {

			previousCompile?.( shader, renderer );
			Object.assign( shader.uniforms, this.uniforms );

			shader.vertexShader = shader.vertexShader
				.replace( '#include <common>', '#include <common>\n' + SNOW_GLSL )
				.replace(
					'#include <beginnormal_vertex>',
					'#include <beginnormal_vertex>\nvWorldNormalW = normalize(mat3(modelMatrix) * objectNormal);'
				)
				.replace(
					'#include <begin_vertex>',
					`#include <begin_vertex>
					vec3 wPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
					vModelPosW = (uModelInv * vec4(wPos, 1.0)).xyz;
					vec3 wN = mat3(modelMatrix) * objectNormal;
					float ms = max(length(wN), 1e-4);
					float accum = snowAccumAt(wN / ms, vModelPosW.xz);
					transformed += normalize(objectNormal) * (uSnowThickness * accum / ms);`
				);

			shader.fragmentShader = shader.fragmentShader
				.replace( '#include <common>', '#include <common>\n' + SNOW_GLSL )
				.replace(
					'#include <map_fragment>',
					`#include <map_fragment>
					vec3 wn = normalize(vWorldNormalW);
					float snowAmt = snowAccumAt(wn, vModelPosW.xz);
					float shade = 0.85 + 0.15 * (fbm(vModelPosW.xz * uSnowBumpScale * 2.0) * 0.5 + 0.5);
					vec3 snowCol = uSnowColor * shade;
					diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowAmt);`
				)
				.replace(
					'#include <roughnessmap_fragment>',
					`#include <roughnessmap_fragment>
					roughnessFactor = mix(roughnessFactor, uSnowRoughness, snowAmt);`
				)
				.replace(
					'#include <normal_fragment_maps>',
					`#include <normal_fragment_maps>
					vec3 sN = snowReliefNormal(vModelPosW.xz);
					vec3 sView = normalize((viewMatrix * vec4(sN, 0.0)).xyz);
					normal = normalize(mix(normal, sView, snowAmt));`
				);

		};

		material.customProgramCacheKey = () => {

			const base = previousKey?.() ?? material.type;
			return `${ base }|vehicle-snow`;

		};

		material.needsUpdate = true;

	}

	/** 每帧刷新世界坐标到车辆局部坐标的矩阵，使积雪斑块随车身移动。 */
	refreshMatrix() {

		this.root.updateWorldMatrix( true, true );
		this.uniforms.uModelInv.value.copy( this.root.matrixWorld ).invert();

	}

	/** 切换车身积雪并重置五秒渐入进度。 */
	setEnabled( enabled: boolean ) {

		this.introEnabled = enabled;
		this.intro = 0;
		this.syncCoverageUniform();

	}

	/** 按帧间隔秒数推进独立渐入，并刷新车身坐标变换。 */
	update( delta: number ) {

		this.refreshMatrix();
		if ( ! this.introEnabled ) {

			return;

		}

		this.intro = Math.min( 1, this.intro + Math.max( 0, delta ) / 5 );
		this.syncCoverageUniform();

	}

	/** 同步地面积雪的覆盖参数与渐入进度，使车身积雪保持一致。 */
	syncCoverageFrom( coverage: number, intro: number, enabled: boolean ) {

		this.params.coverage = THREE.MathUtils.clamp( coverage, 0, 1 );
		this.introEnabled = enabled;
		this.intro = enabled ? THREE.MathUtils.clamp( intro, 0, 1 ) : 0;
		this.syncCoverageUniform();
		this.refreshMatrix();

	}

	private syncCoverageUniform() {

		this.uniforms.uSnowCoverage.value = this.introEnabled
			? this.params.coverage * this.intro
			: 0;

	}

	/** 设置车身积雪覆盖参数并限制在 0–1。 */
	setCoverage( value: number ) {

		this.params.coverage = THREE.MathUtils.clamp( value, 0, 1 );
		this.syncCoverageUniform();

	}

	/** 设置车辆局部斑块噪声频率，最小为 0.00001。 */
	setScale( value: number ) {

		this.params.scale = Math.max( value, 1e-5 );
		this.uniforms.uSnowScale.value = this.params.scale;

	}

	/** 设置非负的积雪边缘过渡半宽。 */
	setEdge( value: number ) {

		this.params.edge = Math.max( value, 0 );
		this.uniforms.uSnowEdge.value = this.params.edge;

	}

	/** 设置非负的积雪厚度，世界单位。 */
	setThickness( value: number ) {

		this.params.thickness = Math.max( value, 0 );
		this.uniforms.uSnowThickness.value = this.params.thickness;

	}

	/** 设置朝上表面阈值并限制在 0–0.99。 */
	setFlatThreshold( value: number ) {

		this.params.flatThreshold = THREE.MathUtils.clamp( value, 0, 0.99 );
		this.uniforms.uSnowFlatThreshold.value = this.params.flatThreshold;

	}

	/** 设置非负的车身积雪起伏频率。 */
	setBumpScale( value: number ) {

		this.params.bumpScale = Math.max( value, 0 );
		this.uniforms.uSnowBumpScale.value = this.params.bumpScale;

	}

	/** 设置非负的车身积雪起伏强度。 */
	setBumpStrength( value: number ) {

		this.params.bumpStrength = THREE.MathUtils.clamp( value, 0, 2 );
		this.uniforms.uSnowBump.value = this.params.bumpStrength;

	}

	/** 设置车身积雪粗糙度并限制在 0–1。 */
	setRoughness( value: number ) {

		this.params.roughness = THREE.MathUtils.clamp( value, 0, 1 );
		this.uniforms.uSnowRoughness.value = this.params.roughness;

	}

	/** 返回当前车身积雪参数对象。 */
	getParams(): Readonly<VehicleSnowParams> {

		return this.params;

	}

	/** 关闭车身积雪并清空材质记录，材质资源由车辆生命周期负责释放。 */
	dispose() {

		this.setEnabled( false );
		this.processed.clear();

	}

}
