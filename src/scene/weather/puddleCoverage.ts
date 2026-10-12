// 提供水面与飞溅共用的积水遮罩、噪声函数和着色器参数。

import * as THREE from 'three';
import { patchShaders, Simplex } from 'gl-noise/build/glNoise.m.js';

/** 积水遮罩默认值，各参数含义见 PuddleCoverageUniforms。 */
export const PUDDLE_COVERAGE_DEFAULTS = {
	coverage: 0.55,
	scale: 0.5,
	edgeSoftness: 0.06
} as const;

/** 水面与飞溅共享的积水遮罩参数对象。 */
export type PuddleCoverageUniforms = {
	/** 积水覆盖参数，范围为 0–1；0 全干，1 覆盖整个圆形贴片。 */
	uPuddleCoverage: THREE.IUniform<number>;
	/** 水块尺寸倍率，最小为 0.01；越大水块越大。 */
	uPuddleScale: THREE.IUniform<number>;
	/** 噪声边缘过渡宽度，范围为 0.001–0.3。 */
	uPuddleEdgeSoftness: THREE.IUniform<number>;
};

/** 创建独立的积水遮罩参数对象，供水面和飞溅共享。 */
export const createPuddleCoverageUniforms = (): PuddleCoverageUniforms => ( {
	uPuddleCoverage: { value: PUDDLE_COVERAGE_DEFAULTS.coverage },
	uPuddleScale: { value: PUDDLE_COVERAGE_DEFAULTS.scale },
	uPuddleEdgeSoftness: { value: PUDDLE_COVERAGE_DEFAULTS.edgeSoftness }
} );

/** 水面与飞溅在水面网格的局部 XY 坐标中计算同一积水遮罩。 */
export const PUDDLE_COVERAGE_SHADER = /* glsl */ `
	uniform float uPuddleCoverage;
	uniform float uPuddleScale;
	uniform float uPuddleEdgeSoftness;

	float getPuddleNoise( vec2 localPosition ) {
		vec2 uv = ( ( localPosition * ( 15.0 / max( uPuddleScale, 0.01 ) ) + vec2( 3.0, 0.0 ) ) * 0.2 + 100.0 ) * 0.5;
		// 显式叠加有符号分形噪声，避免 gln_sfbm 对负数求幂产生未定义结果。
		float noise = ( gln_simplex( uv ) + 0.5 * gln_simplex( uv * 2.0 ) + 0.25 * gln_simplex( uv * 4.0 ) ) / 1.75;
		return clamp( noise * 0.5 + 0.5, 0.0, 1.0 );
	}

	float getPuddleCoverage( vec2 localPosition, float rainFactor ) {
		float growth = smoothstep( 0.15, 1.0, rainFactor );
		if ( growth <= 0.0 || uPuddleCoverage <= 0.0 ) return 0.0;
		float circle = smoothstep( 0.7, 0.85, 1.2 - length( localPosition ) );
		if ( circle <= 0.0 ) return 0.0;
		if ( uPuddleCoverage >= 1.0 ) return circle * growth;

		float noise = getPuddleNoise( localPosition );
		float softness = max( uPuddleEdgeSoftness, 0.001 );
		float threshold = mix( 1.0 + softness, 1.0 - uPuddleCoverage, growth );
		float mask = smoothstep( threshold - softness * 0.5, threshold + softness * 0.5, noise );
		return circle * mask * growth;
	}
`;

/** 注入积水遮罩依赖的单纯形噪声函数。 */
export const patchPuddleCoverageShader = ( shader: string ): string => (
	patchShaders( shader, [ [ Simplex ] ] ) as string
);
