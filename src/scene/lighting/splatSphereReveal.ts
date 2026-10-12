// 驱动高斯点从中心球体向原位置展开，并在完成后恢复光照与细节层级。

import { dyno, type SplatMesh } from '@sparkjsdev/spark';
import { Vector3 } from 'three';
import { SCENE_EFFECT_CONFIG } from '../sceneEffectConfig';

/** 高斯点开场展开动画的状态与控制接口。 */
export type SplatRevealHandle = {
	/** 展开动画是否正在播放。 */
	active: boolean;
	/** 已播放时长，单位为秒。 */
	elapsed: number;
	/** 所有点归位并卸载动画修改器后调用。 */
	onComplete: ( () => void ) | undefined;
	/** 启动展开动画；重复调用不会重新播放。 */
	start: () => void;
	/** 按帧间隔推进展开动画，单位为秒。 */
	update: ( delta: number ) => void;
};

/** 所有高斯点先聚成小球，再按原位置的水平距离从中心向外归位。 */
export const bindSplatSphereReveal = ( mesh: SplatMesh ): SplatRevealHandle => {
	const config = SCENE_EFFECT_CONFIG.reveal;
	const elapsed = dyno.dynoFloat( 0 );
	const center = dyno.dynoVec3( new Vector3( ...config.center ) );
	const holdSeconds = Math.max( 0, config.holdSeconds );
	const spreadSeconds = Math.max( 0, config.spreadSeconds );
	const travelSeconds = Math.max( 0.001, config.travelSeconds );
	const duration = holdSeconds + spreadSeconds + travelSeconds;
	const previousEnableLod = mesh.enableLod;
	let started = false;

	const revealModifier = dyno.dynoBlock(
		{ gsplat: dyno.Gsplat },
		{ gsplat: dyno.Gsplat },
		( { gsplat } ) => {
			const node = new dyno.Dyno( {
				inTypes: {
					gsplat: dyno.Gsplat,
					time: 'float',
					center: 'vec3'
				},
				outTypes: { gsplat: dyno.Gsplat },
				globals: () => [ /* glsl */ `
					uint splatSphereRevealHash( uint value ) {
						value ^= value >> 16u;
						value *= 0x7feb352du;
						value ^= value >> 15u;
						value *= 0x846ca68bu;
						return value ^ ( value >> 16u );
					}

					vec3 splatSphereRevealRandom( uint index ) {
						// 保留 24 位，保证 float 精度下随机值仍处于 [0, 1)。
						return vec3(
							splatSphereRevealHash( index + 1u ) >> 8u,
							splatSphereRevealHash( index + 0x9e3779b9u ) >> 8u,
							splatSphereRevealHash( index + 0x85ebca6bu ) >> 8u
						) / 16777216.0;
					}
				` ],
				statements: ( { inputs, outputs } ) => dyno.unindentLines( /* glsl */ `
					${ outputs.gsplat } = ${ inputs.gsplat };
					vec3 target = ${ inputs.gsplat }.center;
					vec3 origin = ${ inputs.center };
					vec3 random = splatSphereRevealRandom( uint( ${ inputs.gsplat }.index ) );

					// 每个点的球内起点固定；立方根使点在球体体积内均匀分布。
					float polar = random.x * 2.0 - 1.0;
					float angle = random.y * 6.28318530718;
					float ring = sqrt( max( 0.0, 1.0 - polar * polar ) );
					vec3 direction = vec3( ring * cos( angle ), polar, ring * sin( angle ) );
					vec3 spherePosition = origin + direction
						* pow( random.z, 1.0 / 3.0 ) * ${ config.sphereRadius.toFixed( 6 ) };

					// 使用原位置排序，近处先启动；球内随机位置不影响展开顺序。
					float distanceRatio = clamp(
						length( target.xz - origin.xz ) / ${ Math.max( 0.001, config.maxRadius ).toFixed( 9 ) },
						0.0, 1.0
					);
					float delay = ${ holdSeconds.toFixed( 6 ) }
						+ distanceRatio * ${ spreadSeconds.toFixed( 6 ) };
					float progress = clamp(
						( ${ inputs.time } - delay ) / ${ travelSeconds.toFixed( 6 ) }, 0.0, 1.0
					);
					float movement = progress * progress * ( 3.0 - 2.0 * progress );
					${ outputs.gsplat }.center = mix( spherePosition, target, movement );

					// 飞行时保持小点形态，接近归位时恢复原始椭球和透明度。
					float shape = smoothstep( 0.65, 1.0, progress );
					${ outputs.gsplat }.scales = mix(
						vec3( ${ config.pointScale.toFixed( 6 ) } ), ${ inputs.gsplat }.scales, shape
					);
					${ outputs.gsplat }.rgba.a *= mix( 0.75, 1.0, shape );

					// 按高斯点归位进度提亮并放大，形成向外移动的发光波前。
					float glowDistance = ( progress - 0.82 ) / ${ Math.max( 0.001, config.glowWidth ).toFixed( 6 ) };
					float glowRing = pow( exp( -glowDistance * glowDistance ), 1.35 );
					glowRing *= smoothstep( 0.55, 0.7, progress )
						* ( 1.0 - smoothstep( 0.94, 1.0, progress ) );
					glowRing = clamp( glowRing * ${ Math.max( 0, config.glowStrength ).toFixed( 6 ) }, 0.0, 1.0 );
					vec3 glowColor = vec3( ${ config.glowColor.map( value => value.toFixed( 6 ) ).join( ', ' ) } );
					${ outputs.gsplat }.rgba.rgb = mix( ${ outputs.gsplat }.rgba.rgb, glowColor, glowRing * 0.88 );
					${ outputs.gsplat }.rgba.rgb += glowColor * glowRing * 0.7;
					${ outputs.gsplat }.rgba.a = mix( ${ outputs.gsplat }.rgba.a, 1.0, glowRing * 0.7 );
					${ outputs.gsplat }.scales *= 1.0 + glowRing * 1.15;
				` )
			} );

			return { gsplat: node.apply( { gsplat, time: elapsed, center } ).gsplat };
		}
	);

	// 从加载的第一帧就显示小球，避免加载页淡出时先露出完整模型。
	mesh.enableLod = false;
	mesh.objectModifier = revealModifier;
	mesh.updateGenerator();

	const handle: SplatRevealHandle = {
		active: false,
		elapsed: 0,
		onComplete: undefined,
		start() {
			if ( started ) {
				return;
			}
			started = true;
			handle.active = true;
			mesh.updateVersion();
		},
		update( delta: number ) {
			if ( ! handle.active ) {
				return;
			}

			handle.elapsed = Math.min( duration, handle.elapsed + Math.max( 0, delta ) );
			elapsed.value = handle.elapsed;
			mesh.updateVersion();

			if ( handle.elapsed >= duration ) {
				handle.active = false;
				mesh.objectModifier = undefined;
				mesh.enableLod = previousEnableLod;
				mesh.updateGenerator();
				mesh.updateVersion();
				handle.onComplete?.();
			}
		}
	};

	return handle;
};
