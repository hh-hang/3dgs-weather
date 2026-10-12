// 按天气和昼夜同步天空、环境光、高斯点受光、车灯与灯光遮挡。

import * as THREE from 'three';
import type { SunLight } from 'three/addons/lights/SunLight.js';
import type { SplatMesh } from '@sparkjsdev/spark';
import { worldLen } from '../sceneScale';
import type { ColliderLightShadows } from '../collider/colliderLightShadows';
import type { ThunderSky } from '../weather/ThunderSky';
import type { SnowEffect } from '../weather/SnowEffect';
import type { WeatherAudio } from '../weather/weatherAudio';
import type { VehicleHeadlights } from '../vehicle/vehicleHeadlights';
import type { SceneFloodLights } from './sceneFloodLights';
import {
	createSplatLighting,
	isNightTimeOfDay,
	sunColorFromElevation,
	sunDirectionFromTimeOfDay,
	sunIntensityFromElevation,
	type SplatLightingHandle
} from './splatLighting';

const SUN_INTENSITY_DAY = 2;
const SUN_INTENSITY_NIGHT = 0.15;
const SUN_OVERCAST_SCALE = 0.85 / SUN_INTENSITY_DAY;
/** 太阳阴影相机的近裁剪距离，世界单位。 */
export const SUN_SHADOW_NEAR = worldLen( 25 );
/** 太阳阴影相机的远裁剪距离，世界单位。 */
export const SUN_SHADOW_FAR = worldLen( 10000 );
/** 太阳阴影沿表面法线的偏移，世界单位。 */
export const SUN_SHADOW_NORMAL_BIAS = worldLen( 1.0 );
const AMBIENT_INTENSITY_DEFAULT = 1;
const AMBIENT_INTENSITY_WEATHER = 0.8;
const AMBIENT_INTENSITY_LIT = 0.5;
const CHARACTER_AMBIENT_BOOST = 10;

/** 驱动昼夜和天气光照的场景状态。 */
export type SceneLightingState = {
	/** 是否启用降雨。 */
	rainEnabled: boolean;
	/** 是否启用降雪。 */
	snowEnabled: boolean;
	/** 是否启用动态光照。 */
	lightingEnabled: boolean;
	/** 是否启用碰撞体灯光遮挡。 */
	lightOcclusionEnabled: boolean;
	/** 一天中的归一化时刻，范围为 0–1；0 为午夜，0.5 为正午。 */
	timeOfDay: number;
};

/** 统一同步天空、环境光、高斯点受光和灯光遮挡。 */
export class SceneLightingController {

	/** 高斯点光照的挂载与参数同步接口。 */
	splatLighting: SplatLightingHandle = createSplatLighting();
	private envRenderTarget?: THREE.WebGLRenderTarget;

	constructor(
		private readonly getScene: () => THREE.Scene | undefined,
		private readonly getRenderer: () => THREE.WebGLRenderer | undefined,
		private readonly getSky: () => ThunderSky | undefined,
		private readonly getSunLight: () => SunLight | undefined,
		private readonly getAmbientLight: () => THREE.AmbientLight | undefined,
		private readonly getPmrem: () => THREE.PMREMGenerator | undefined,
		private readonly getSplat: () => SplatMesh | undefined,
		private readonly getSnowEffect: () => SnowEffect | undefined,
		private readonly getWeatherAudio: () => WeatherAudio | undefined,
		private readonly getFloodLights: () => SceneFloodLights | undefined,
		private readonly getLightShadows: () => ColliderLightShadows | undefined,
		private readonly getColliderDepth: () => THREE.Object3D | undefined,
		private readonly getHeadlights: () => VehicleHeadlights | undefined,
		private readonly getState: () => SceneLightingState
	) {}

	/** 判断当前是否因降雨或降雪使用阴天光照。 */
	isOvercast() {

		const { rainEnabled, snowEnabled } = this.getState();
		return rainEnabled || snowEnabled;

	}

	/** 按太阳是否在地平线上方及天气状态计算网格太阳光强度。 */
	resolveSunLightIntensity( aboveHorizon: boolean ) {

		const clear = aboveHorizon ? SUN_INTENSITY_DAY : SUN_INTENSITY_NIGHT;
		return this.isOvercast() ? clear * SUN_OVERCAST_SCALE : clear;

	}

	/** 按动态光照开关与天气状态计算环境光强度。 */
	resolveAmbient() {

		const { lightingEnabled } = this.getState();
		if ( lightingEnabled ) {

			return AMBIENT_INTENSITY_LIT;

		}

		return this.isOvercast() ? AMBIENT_INTENSITY_WEATHER : AMBIENT_INTENSITY_DEFAULT;

	}

	/** 设置天气对应的云层与大气参数，并同步太阳位置。 */
	applySkyWeather() {

		const sky = this.getSky();
		if ( ! sky ) {

			return;

		}

		const uniforms = sky.material.uniforms;
		const overcast = this.isOvercast();
		uniforms[ 'turbidity' ].value = 10;
		uniforms[ 'rayleigh' ].value = 1.2;
		uniforms[ 'mieCoefficient' ].value = 0.001;
		uniforms[ 'mieDirectionalG' ].value = 0.76;
		uniforms[ 'cloudCoverage' ].value = overcast ? 1 : 0.4;
		uniforms[ 'cloudDensity' ].value = overcast ? 0.75 : 0.4;
		uniforms[ 'cloudElevation' ].value = overcast ? 0.55 : 0.5;
		uniforms[ 'showSunDisc' ].value = overcast ? 0 : 1;
		this.syncSkySunFromTime();

	}

	/** 按时刻同步太阳、月亮、阴影开关与环境反射贴图。 */
	syncSkySunFromTime() {

		const { timeOfDay, lightingEnabled } = this.getState();
		const { direction, aboveHorizon } = sunDirectionFromTimeOfDay( timeOfDay );
		const sky = this.getSky();
		const sunLight = this.getSunLight();
		const renderer = this.getRenderer();
		const overcast = this.isOvercast();

		if ( sky ) {

			sky.material.uniforms[ 'sunPosition' ].value.copy( direction );
			sky.material.uniforms[ 'moonDirection' ].value.copy( direction ).multiplyScalar( - 1 );
			if ( ! overcast ) {

				sky.material.uniforms[ 'showSunDisc' ].value = aboveHorizon ? 1 : 0;

			}

		}

		if ( sunLight ) {

			sunLight.position.copy( direction );
			sunLight.intensity = this.resolveSunLightIntensity( aboveHorizon );
			sunLight.castShadow = lightingEnabled && ! overcast && aboveHorizon;

		}

		if ( renderer ) {

			renderer.shadowMap.enabled = lightingEnabled && ! overcast;

		}

		const scene = this.getScene();
		const pmrem = this.getPmrem();
		if ( sky && pmrem && scene ) {

			// 环境光始终采样完整天空，避免天空隐藏、开场底色与亮带影响反射贴图。
			const reveal = sky.material.uniforms[ 'revealProgress' ];
			const progress = reveal.value;
			const visible = sky.visible;
			reveal.value = 1;
			sky.visible = true;
			try {

				const target = pmrem.fromScene( sky as unknown as THREE.Scene );
				this.envRenderTarget?.dispose();
				this.envRenderTarget = target;
				scene.environment = target.texture;

			} finally {

				reveal.value = progress;
				sky.visible = visible;

			}

		}

	}

	/** 同步人物和普通网格使用的环境光强度。 */
	syncCharacterAmbient() {

		const ambient = this.getAmbientLight();
		if ( ambient ) {

			ambient.intensity = this.resolveAmbient() + CHARACTER_AMBIENT_BOOST;

		}

	}

	/** 将环境光与太阳参数同步到雪花粒子。 */
	syncSnowLighting() {

		const snowEffect = this.getSnowEffect();
		if ( ! snowEffect ) {

			return;

		}

		const { timeOfDay, lightingEnabled } = this.getState();
		const { direction, elevationDeg } = sunDirectionFromTimeOfDay( timeOfDay );
		snowEffect.setLighting( {
			ambientEnabled: true,
			ambientIntensity: this.resolveAmbient(),
			ambientColor: new THREE.Color( 1, 1, 1 ),
			sunEnabled: lightingEnabled,
			sunIntensity: sunIntensityFromElevation( elevationDeg ),
			sunColor: sunColorFromElevation( elevationDeg, new THREE.Color() ),
			sunDirection: direction
		} );

	}

	/** 按降雨和昼夜状态同步环境音。 */
	syncWeatherAudio() {

		const { rainEnabled, timeOfDay } = this.getState();
		this.getWeatherAudio()?.setRainEnabled( rainEnabled );
		this.getWeatherAudio()?.setNightEnabled( isNightTimeOfDay( timeOfDay ) );

	}

	/** 同步照射灯的昼夜状态，按需重建灯光对象并更新高斯点参数。 */
	syncFloodLights( rebuild = false ) {

		const { timeOfDay } = this.getState();
		const night = isNightTimeOfDay( timeOfDay );
		const floods = this.getFloodLights();
		if ( rebuild ) {

			floods?.rebuild();

		}

		floods?.setNight( night );
		this.splatLighting.setFloodLights( floods?.lights ?? [], this.getSplat(), night );

	}

	/** 同步高斯点光照以及关联的天空、雪花和灯光遮挡状态。 */
	applySplatLighting() {

		this.syncCharacterAmbient();
		const { lightingEnabled, timeOfDay } = this.getState();
		this.splatLighting.setAmbientEnabled( true );
		this.splatLighting.setAmbientIntensity( this.resolveAmbient() );
		this.splatLighting.setSunEnabled( lightingEnabled );
		this.splatLighting.setTimeOfDay( timeOfDay );
		this.syncFloodLights();
		this.syncSkySunFromTime();
		this.syncSnowLighting();
		this.syncLightOcclusion();

	}

	/** 按开关更新灯光深度图，并绑定到高斯点光照。 */
	syncLightOcclusion() {

		const { lightingEnabled, lightOcclusionEnabled, timeOfDay } = this.getState();
		if ( ! lightingEnabled || ! lightOcclusionEnabled ) {

			this.splatLighting.setOcclusion( null );
			return;

		}

		const renderer = this.getRenderer();
		const lightShadows = this.getLightShadows();
		if ( ! renderer || ! lightShadows ) {

			return;

		}

		const splat = this.getSplat();
		splat?.updateWorldMatrix( true, false );
		const night = isNightTimeOfDay( timeOfDay );
		const beams = this.getHeadlights()?.hasBeams ? this.getHeadlights()!.getSplatBeams() : null;
		const colliderDepth = this.getColliderDepth();
		lightShadows.update(
			renderer,
			colliderDepth,
			splat?.matrixWorld,
			beams,
			this.getFloodLights()?.lights ?? [],
			night
		);
		this.splatLighting.setOcclusion( colliderDepth ? lightShadows.slots : null );

	}

	/** 将车辆近光的世界空间参数同步到高斯点光照。 */
	syncSplatHeadlights() {

		const beams = this.getHeadlights()?.hasBeams ? this.getHeadlights()!.getSplatBeams() : null;
		const splat = this.getSplat();
		if ( beams && splat ) {

			this.splatLighting.setHeadlights( beams, splat );

		} else {

			this.splatLighting.setHeadlights( null );

		}

	}

	/** 开场展开完成后挂载高斯点光照并同步当前场景状态。 */
	attachAfterReveal( splat: SplatMesh ) {

		if ( this.splatLighting.attached ) {

			return;

		}

		this.splatLighting.attach( splat );
		this.applySplatLighting();
		this.syncSplatHeadlights();

	}

	/** 释放高斯点光照管理器与环境反射渲染目标。 */
	dispose() {

		this.splatLighting.dispose();
		this.envRenderTarget?.dispose();
		this.envRenderTarget = undefined;

	}

}
