// 创建透明积水材质，合成涟漪、菲涅耳反射与直接光照。

import * as THREE from 'three';
import CustomShaderMaterial, { type CSMProxy } from 'three-custom-shader-material/vanilla';
import {
	createPuddleCoverageUniforms,
	patchPuddleCoverageShader,
	PUDDLE_COVERAGE_SHADER,
	type PuddleCoverageUniforms
} from './puddleCoverage';

/** 水的折射率；物理材质据此计算正入射反射率 F0 = ((ior - 1) / (ior + 1))²。 */
export const PUDDLE_WATER_IOR = 1.333;

/**
 * 积水材质移植自 Faraz-Portfolio/demo-2023-rain-puddle 的 src/Floor/PuddleMaterial.tsx，
 * 来源提交为 257066b63d08b227df8f982377e60f91752ddc81，许可证为 GPL-3.0。
 * 来源与许可说明见 THIRD_PARTY_NOTICES.md 和 third_party/Faraz-rain-puddle-GPL-3.0.txt。
 */
/** 积水顶点着色器，保存水面局部坐标并计算反射投影。 */
export const PUDDLE_VERTEX_SHADER = /* glsl */ `
	uniform mat4 uReflectionMatrix;
	varying vec3 vPuddlePosition;
	varying vec4 vReflectionPosition;
	void main() {
		vPuddlePosition = position;
		vReflectionPosition = uReflectionMatrix * modelMatrix * vec4( position, 1.0 );
	}
`;

/** 积水片元着色器，计算覆盖、涟漪法线、反射与预乘透明输出。 */
export const PUDDLE_FRAGMENT_SHADER = patchPuddleCoverageShader( /* glsl */ `
	uniform float uTime;
	uniform float uRainFactor;
	uniform float uOpacity;
	uniform float uRippleStrength;
	uniform float uRippleScale;
	uniform float uWaterRoughness;
	uniform float uReflectionBlur;
	uniform sampler2D tSceneReflection;
	uniform vec2 uReflectionTexel;
	uniform float uReflectionReady;
	uniform float uReflectionStrength;
	varying vec3 vPuddlePosition;
	varying vec4 vReflectionPosition;
	vec3 csm_PuddleNormal;
	float csm_PuddleCoverage;
	${ PUDDLE_COVERAGE_SHADER }

	#define MAX_RADIUS 1
	#define HASHSCALE1 .1031
	#define HASHSCALE3 vec3(.1031, .1030, .0973)

	float hash12( vec2 p ) {
		vec3 p3 = fract( vec3( p.xyx ) * HASHSCALE1 );
		p3 += dot( p3, p3.yzx + 19.19 );
		return fract( ( p3.x + p3.y ) * p3.z );
	}

	vec2 hash22( vec2 p ) {
		vec3 p3 = fract( vec3( p.xyx ) * HASHSCALE3 );
		p3 += dot( p3, p3.yzx + 19.19 );
		return fract( ( p3.xx + p3.yz ) * p3.zy );
	}

	vec3 getRipples( vec2 uv ) {
		vec2 p0 = floor( uv );
		float time = uTime * 3.0;
		vec2 circles = vec2( 0.0 );
		for ( int j = - MAX_RADIUS; j <= MAX_RADIUS; ++ j ) {
			for ( int i = - MAX_RADIUS; i <= MAX_RADIUS; ++ i ) {
				vec2 pi = p0 + vec2( i, j );
				vec2 p = pi + hash22( pi );
				float t = fract( 0.3 * time + hash12( pi ) );
				vec2 v = p - uv;
				float d = length( v ) - ( float( MAX_RADIUS ) + 1.0 ) * t;
				float h = 1e-3;
				float d1 = d - h;
				float d2 = d + h;
				float p1 = sin( 31.0 * d1 ) * smoothstep( -0.6, -0.3, d1 ) * ( 1.0 - smoothstep( -0.3, 0.0, d1 ) );
				float p2 = sin( 31.0 * d2 ) * smoothstep( -0.6, -0.3, d2 ) * ( 1.0 - smoothstep( -0.3, 0.0, d2 ) );
				circles += 0.5 * ( v / max( length( v ), 1e-5 ) ) * ( ( p2 - p1 ) / ( 2.0 * h ) * ( 1.0 - t ) * ( 1.0 - t ) );
			}
		}
		circles /= float( ( MAX_RADIUS * 2 + 1 ) * ( MAX_RADIUS * 2 + 1 ) );
		return vec3( circles, sqrt( max( 0.0, 1.0 - dot( circles, circles ) ) ) );
	}

	// 去除水面模型缩放对法线的影响，使涟漪强度不随贴片尺寸放大。
	mat3 puddleViewRotation() {
		mat3 rotation = mat3( csm_internal_vModelViewMatrix );
		rotation[ 0 ] = normalize( rotation[ 0 ] );
		rotation[ 1 ] = normalize( rotation[ 1 ] );
		rotation[ 2 ] = normalize( rotation[ 2 ] );
		return rotation;
	}

	vec3 perturbNormal( vec3 inputNormal, vec3 noiseNormal, float strength ) {
		vec3 orthogonal = noiseNormal - dot( noiseNormal, inputNormal ) * inputNormal;
		vec3 projected = puddleViewRotation() * orthogonal;
		return normalize( inputNormal - projected * strength );
	}

	void applySceneReflection(
		inout vec3 litColor, inout float alpha, vec3 shadingNormal, vec3 viewDirection,
		float surfaceRoughness, float specularF0, float specularF90
	) {
		// 复用物理材质由折射率推导的反射率与 Schlick 公式，保持镜像反射和直接光照一致。
		float dotNV = clamp( dot( normalize( shadingNormal ), viewDirection ), 0.0, 1.0 );
		float fresnel = F_Schlick( specularF0, specularF90, dotNV );
		vec3 reflection = vec3( 0.0 );
		float reflectedWeight = 0.0;
		if ( uReflectionReady > 0.5 && vReflectionPosition.w > 0.0 ) {
			vec2 uv = vReflectionPosition.xy / vReflectionPosition.w;
			if ( all( greaterThanEqual( uv, vec2( 0.0 ) ) ) && all( lessThanEqual( uv, vec2( 1.0 ) ) ) ) {
				// 涟漪法线扰动反射投影；粗糙度控制采样模糊，菲涅耳权重独立计算。
				uv += ( shadingNormal.xy - normalize( vNormal ).xy ) * 0.02;
				uv = clamp( uv, uReflectionTexel, vec2( 1.0 ) - uReflectionTexel );
				float roughness = clamp( surfaceRoughness, 0.0, 1.0 );
				reflection = texture2D( tSceneReflection, uv, roughness * uReflectionBlur ).rgb * uReflectionStrength;
				// 先完成与主画面相同的颜色转换，再乘反射权重，避免透明水层额外增亮。
				#ifdef TONE_MAPPING
					reflection = toneMapping( reflection );
				#endif
				reflection = linearToOutputTexel( vec4( reflection, 1.0 ) ).rgb;
				reflectedWeight = fresnel;
			}
		}
		float waterStrength = csm_PuddleCoverage * uOpacity;
		// 采用预乘输出：反射权重为强度乘菲涅耳系数，透射权重由目标混合保留。
		// 直接光照颜色已包含菲涅耳项，合成时需避免重复乘权。
		litColor = waterStrength * ( litColor + reflection * reflectedWeight );
		alpha = waterStrength * reflectedWeight;
	}

	void main() {
		float roughnessProgress = clamp( smoothstep( 0.0, 0.75, uRainFactor ), 0.0, 1.0 );
		csm_PuddleCoverage = getPuddleCoverage( vPuddlePosition.xy, uRainFactor );
		if ( csm_PuddleCoverage <= 0.0 || uOpacity <= 0.0 ) discard;
		csm_Roughness = mix( 0.18, uWaterRoughness, roughnessProgress );

		vec3 rippleNormals = getRipples( vPuddlePosition.xy * ( 40.0 / uRippleScale ) );
		csm_PuddleNormal = perturbNormal( normalize( vNormal ), rippleNormals, uRippleStrength * uRainFactor * csm_PuddleCoverage );
		// 透明薄水层只叠加界面光照，底部颜色由场景地面提供。
		csm_DiffuseColor.rgb = vec3( 0.0 );
		csm_DiffuseColor.a = csm_PuddleCoverage * uOpacity;
	}
` );

/** 带积水着色器与共享参数的物理材质类型。 */
export type PuddleMaterial = CSMProxy<typeof THREE.MeshPhysicalMaterial>;

/** 创建共享降雨进度与覆盖参数的透明积水材质。 */
export const createPuddleMaterial = (
	rainProgress: THREE.IUniform<number>, opacity: number, rippleScale = 1,
	coverageUniforms: PuddleCoverageUniforms = createPuddleCoverageUniforms()
): PuddleMaterial => {
	const material = new CustomShaderMaterial( {
		baseMaterial: THREE.MeshPhysicalMaterial,
		vertexShader: PUDDLE_VERTEX_SHADER,
		fragmentShader: PUDDLE_FRAGMENT_SHADER,
		uniforms: {
			...coverageUniforms,
			uTime: { value: 0 },
			uRainFactor: rainProgress,
			uOpacity: { value: THREE.MathUtils.clamp( opacity, 0, 1 ) },
			uRippleStrength: { value: 0.25 },
			uRippleScale: { value: Math.max( 0.001, rippleScale ) },
			uWaterRoughness: { value: 0.04 },
			uReflectionBlur: { value: 5 },
			tSceneReflection: { value: null },
			uReflectionMatrix: { value: new THREE.Matrix4() },
			uReflectionTexel: { value: new THREE.Vector2( 1 / 512, 1 / 512 ) },
			uReflectionReady: { value: 0 },
			uReflectionStrength: { value: 0.85 }
		},
		patchMap: {
			'*': {
				'#include <colorspace_fragment>': /* glsl */ `
					#include <colorspace_fragment>
					applySceneReflection( gl_FragColor.rgb, gl_FragColor.a, normal, geometryViewDir,
						roughnessFactor, material.specularColor.r, material.specularF90 );
				`,
				'#include <normal_fragment_maps>': /* glsl */ `
					#include <normal_fragment_maps>
					normal = normalize( csm_PuddleNormal );
				`
			}
		},
		ior: PUDDLE_WATER_IOR,
		metalness: 0,
		transparent: true,
		// 颜色已在输出转换后预乘权重；源混合系数设为 1，避免再次乘透明度。
		blending: THREE.CustomBlending,
		blendEquation: THREE.AddEquation,
		blendSrc: THREE.OneFactor,
		blendDst: THREE.OneMinusSrcAlphaFactor,
		envMapIntensity: 0,
		// 透明水层保留模型深度，供后续雨滴和飞溅进行遮挡测试。
		depthWrite: false
	} ) as unknown as PuddleMaterial;
	material.name = 'FarazPuddleMaterial';
	return material;
};
