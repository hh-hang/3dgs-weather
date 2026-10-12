// 管理场景资源、渲染循环，以及天气、光照、积水和漫游子系统。

import * as THREE from 'three';
import { SplatMesh, SparkRenderer } from '@sparkjsdev/spark';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { t } from '../i18n';
import {
	bindColliderShadowReceivers,
	createColliderDepthOccluder,
	createColliderWireframe,
	disposeColliderDepthOccluder
} from './collider/GroundShadowReceiver';
import { renderWithMeshDepthPass, syncColliderDepthMode } from './collider/meshDepthPass';
import { ColliderLightShadows } from './collider/colliderLightShadows';
import { PuddleTransformTools } from './debug/puddleTransformTools';
import { SceneDebugGui } from './debug/sceneDebugGui';
import { SplatPickTools } from './debug/splatPickTools';
import { createGltfLoader } from './gltfLoader';
import { FLOOD_LIGHT_LIMIT, SceneFloodLights } from './lighting/sceneFloodLights';
import {
	SceneLightingController,
	SUN_SHADOW_FAR,
	SUN_SHADOW_NEAR,
	SUN_SHADOW_NORMAL_BIAS
} from './lighting/sceneLightingController';
import { isNightTimeOfDay, sunDirectionFromTimeOfDay } from './lighting/splatLighting';
import { bindSplatSphereReveal, type SplatRevealHandle } from './lighting/splatSphereReveal';
import { SCENE_EFFECT_CONFIG } from './sceneEffectConfig';
import { worldLen } from './sceneScale';
import { CHARACTER_URL, WalkSession } from './vehicle/walkSession';
import { ColliderSnowAccumulation } from './weather/colliderSnowAccumulation';
import { LightningStorm } from './weather/lightningStorm';
import { RainEffect } from './weather/RainEffect';
import { PuddlePatchSystem, type PuddlePatchConfig } from './weather/puddlePatchSystem';
import { SceneSnowSystem } from './weather/sceneSnowSystem';
import { SnowEffect } from './weather/SnowEffect';
import { ThunderSky } from './weather/ThunderSky';
import { WeatherAudio } from './weather/weatherAudio';

/** 场景观察模式：环视或漫游。 */
export type ViewerMode = 'view' | 'walk';

/** 场景加载状态，分别表示高斯点场景与漫游资源是否就绪。 */
export type SceneStatus = {
	/** 高斯点场景加载进度，范围为 0–100。 */
	progress: number;
	/** 高斯点场景是否完成下载与解码。 */
	ready: boolean;
	/** 人物与碰撞资源是否已就绪，可进入漫游。 */
	walkReady: boolean;
	/** 资源加载失败时的错误信息。 */
	error?: string;
};

type LoadingAssetKey = 'model' | 'collider' | 'character';

type LoadingAssetProgress = {
	loaded: number;
	total: number;
};

const asset = ( path: string ) => `${ import.meta.env.BASE_URL }${ path }`;
const MODEL_URL = asset( 'scene/scene.sog' );
const COLLIDER_URL = asset( 'scene/collider.glb' );
/** 多块积水贴片；position 的 Y 直接表示最终水面高度。 */
const PUDDLE_PATCHES: PuddlePatchConfig[] = [
	{
		position: [ - 20.2, - 40, - 13 ],
		size: [ worldLen( 11000 ), worldLen( 11000 ) ],
		rotation: [ - 0.53687 * Math.PI / 180, 2.999439 * Math.PI / 180, 0.811109 * Math.PI / 180 ]
	}
];
const MODEL_POSITION: [ number, number, number ] = [ 0, 0, 0 ];
const MODEL_ROTATION: [ number, number, number ] = [ 0, - Math.PI / 2, Math.PI ];
const MODEL_SCALE: [ number, number, number ] = [ 1, 1, 1 ];
const FALLBACK_ASSET_SIZES: Record<LoadingAssetKey, number> = {
	model: 47_982_875,
	collider: 1_540_244,
	character: 14_057_948
};
const SPLAT_DOWNLOAD_PROGRESS_SHARE = 97;
const SCROLL_KEY_CODES = new Set( [
	'Space',
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'PageUp',
	'PageDown'
] );
/** 协调场景初始化、外部状态设置与各子系统的逐帧更新。 */
export class WeatherScene {
	private readonly loadingAssets: Record<LoadingAssetKey, LoadingAssetProgress> = {
		model: { loaded: 0, total: FALLBACK_ASSET_SIZES.model },
		collider: { loaded: 0, total: FALLBACK_ASSET_SIZES.collider },
		character: { loaded: 0, total: FALLBACK_ASSET_SIZES.character }
	};
	private scene?: THREE.Scene;
	private camera?: THREE.PerspectiveCamera;
	private renderer?: THREE.WebGLRenderer;
	private spark?: SparkRenderer;
	private splat?: SplatMesh;
	private controls?: OrbitControls;
	private sky?: ThunderSky;
	private sunLight?: SunLight;
	private ambientLight?: THREE.AmbientLight;
	private pmremGenerator?: THREE.PMREMGenerator;
	private rainEffect?: RainEffect;
	private snowEffect?: SnowEffect;
	private puddlePatchSystem?: PuddlePatchSystem;
	private lightningStorm?: LightningStorm;
	private weatherAudio?: WeatherAudio;
	private debugGui?: SceneDebugGui;
	private splatReveal?: SplatRevealHandle;
	/** 天空开场已播放时长；未定义时等待高斯点展开结束。 */
	private skyRevealElapsed?: number;
	private readonly skyRevealDuration = Math.max( 0, SCENE_EFFECT_CONFIG.reveal.spreadSeconds )
		+ Math.max( 0.001, SCENE_EFFECT_CONFIG.reveal.travelSeconds );
	private colliderRoot?: THREE.Group;
	private colliderDepth?: THREE.Group;
	private colliderWireframe?: THREE.Group;
	private colliderWireframeVisible = false;
	/** 网格深度遮挡开关；关闭时按雨雪和水面状态启用粒子深度层。 */
	private meshDepthOcclusionEnabled = true;
	private colliderSnow?: ColliderSnowAccumulation;
	private readonly snowSystem = new SceneSnowSystem();
	private pickTools?: SplatPickTools;
	private puddleTransform?: PuddleTransformTools;
	private readonly walk = new WalkSession( {
		getMode: () => this.mode,
		getTimeOfDay: () => this.timeOfDay,
		isDisposed: () => this.disposed,
		onHeadlightsSync: () => this.lighting.syncSplatHeadlights(),
		onControlHintMode: ( mode ) => this.onControlHintMode?.( mode )
	} );
	private onControlHintMode?: ( mode: 'on-foot' | 'vehicle' ) => void;
	private lighting!: SceneLightingController;
	private floodLights?: SceneFloodLights;
	private lightShadows?: ColliderLightShadows;
	/** 碰撞体灯光遮挡开关，同时作用于车灯和照射灯。 */
	private lightOcclusionEnabled = false;
	private resizeObserver?: ResizeObserver;
	private animationFrame = 0;
	private previousTime = performance.now();
	private disposed = false;
	private progress = 0;
	private error = '';
	private splatReady = false;
	private walkReady = false;
	private mode: ViewerMode = 'view';
	private rainEnabled = false;
	private snowEnabled = false;
	private skyEnabled = true;
	private lightingEnabled = true;
	private debugEnabled = false;
	private timeOfDay = 9 / 24;
	private readonly stopAutoRotate = () => {
		if ( this.mode === 'view' && this.controls ) {
			this.controls.autoRotate = false;
		}
	};

	constructor(
		private readonly stage: HTMLElement,
		private readonly onStatus: ( status: SceneStatus ) => void,
		onControlHintMode?: ( mode: 'on-foot' | 'vehicle' ) => void
	) {
		this.onControlHintMode = onControlHintMode;
		this.lighting = new SceneLightingController(
			() => this.scene,
			() => this.renderer,
			() => this.sky,
			() => this.sunLight,
			() => this.ambientLight,
			() => this.pmremGenerator,
			() => this.splat,
			() => this.snowEffect,
			() => this.weatherAudio,
			() => this.floodLights,
			() => this.lightShadows,
			() => this.colliderDepth,
			() => this.walk.vehicleHeadlights,
			() => ( {
				rainEnabled: this.rainEnabled,
				snowEnabled: this.snowEnabled,
				lightingEnabled: this.lightingEnabled,
				lightOcclusionEnabled: this.lightOcclusionEnabled,
				timeOfDay: this.timeOfDay
			} )
		);
	}

	/** 初始化渲染器并并行加载高斯点与漫游资源，分别报告就绪状态。 */
	async init() {
		try {
			this.createRenderer();
			this.createEnvironment();
			this.createControls();
			this.resizeObserver = new ResizeObserver( () => this.resize() );
			this.resizeObserver.observe( this.stage );
			window.addEventListener( 'keydown', this.preventBrowserScroll, { capture: true, passive: false } );
			this.pickTools = new SplatPickTools(
				this.stage,
				() => this.scene,
				() => this.camera,
				() => this.splat,
				() => this.debugEnabled,
				this.stopAutoRotate
			);
			this.puddleTransform = new PuddleTransformTools(
				() => this.scene,
				() => this.camera,
				() => this.renderer,
				() => this.controls,
				() => this.puddlePatchSystem,
				() => this.mode,
				this.stopAutoRotate,
				() => this.syncDebugGui()
			);
			this.resize();
			this.startAnimationLoop();

			this.report( 1 );
			await this.resolveAssetSizes();
			await Promise.all( [
				this.loadSplat(),
				this.loadWalkAssets()
			] );
			this.report( 100 );
		} catch ( error ) {
			const message = error instanceof Error ? error.message : t( 'ui.unknownError' );
			this.report( this.progress, message );
		}
	}

	/** 由加载界面关闭触发，保证开场动画不会在加载遮罩后提前播放。 */
	startSplatReveal() {
		if ( ! this.disposed && this.splatReady ) {
			this.splatReveal?.start();
		}
	}

	/** 切换环视或漫游；首次漫游按需初始化人物与车辆控制。 */
	setMode( mode: ViewerMode ) {
		if ( this.mode === mode ) {
			return;
		}

		this.mode = mode;
		if ( mode === 'walk' ) {
			this.puddleTransform?.setEnabled( this.puddleTransform?.enabledPatchIndex ?? 0, false );
			void this.enterWalk();
			return;
		}

		if ( this.scene && this.camera && this.controls ) {
			this.walk.exitToOverview( this.scene, this.camera, this.controls );
		}
	}

	/** 切换降雨，并同步积水、雷电、音效与光照状态。 */
	setRain( enabled: boolean ) {
		this.rainEnabled = enabled;
		this.rainEffect?.setEnabled( enabled );
		this.puddlePatchSystem?.setEnabled( enabled );
		this.lightningStorm?.setEnabled( enabled );
		this.lighting.syncWeatherAudio();
		this.syncColliderDepthVisible();
		this.lighting.applySkyWeather();
		this.lighting.applySplatLighting();
		this.syncDebugGui();
	}

	/** 切换降雪，并同步地面与车身积雪及光照状态。 */
	setSnow( enabled: boolean ) {
		this.snowEnabled = enabled;
		this.snowEffect?.setEnabled( enabled );
		this.colliderSnow?.setEnabled( enabled );
		this.snowSystem.setEnabled( enabled, this.renderer );
		this.syncColliderDepthVisible();
		this.lighting.applySkyWeather();
		this.lighting.applySplatLighting();
		this.syncDebugGui();
	}

	/** 切换天空可见性，高斯点展开结束前保持隐藏。 */
	setSky( enabled: boolean ) {
		this.skyEnabled = enabled;
		if ( this.sky ) {
			this.sky.visible = enabled && this.skyRevealElapsed !== undefined;
		}
	}

	/** 切换动态光照，并同步网格阴影与高斯点灯光遮挡。 */
	setLighting( enabled: boolean ) {
		this.lightingEnabled = enabled;
		this.lighting.applySplatLighting();
	}

	/** 切换网格深度遮挡并重新选择碰撞深度模式。 */
	setMeshDepthOcclusion( enabled: boolean ) {
		this.meshDepthOcclusionEnabled = enabled;
		this.syncColliderDepthVisible();
	}

	/** 设置一天中的归一化时刻，范围为 0–1，并同步光照与音效。 */
	setTimeOfDay( value: number ) {
		this.timeOfDay = THREE.MathUtils.clamp( value, 0, 1 );
		this.lighting.applySplatLighting();
		this.lighting.syncWeatherAudio();
	}

	/** 切换调试面板及碰撞、胶囊体、拾取和位姿辅助显示。 */
	setDebug( enabled: boolean ) {
		this.debugEnabled = enabled;
		if ( ! enabled ) {
			this.pickTools?.setArmed( false, this.controls );
			this.puddleTransform?.setEnabled( this.puddleTransform?.enabledPatchIndex ?? 0, false );
		}
		this.syncDebugGui();
		this.syncColliderWireframe();
		this.pickTools?.syncMarkers();
		this.walk.syncCapsuleVisible( this.debugEnabled );
	}

	/** 停止渲染和输入监听，释放场景及子系统资源。 */
	dispose() {
		this.disposed = true;
		cancelAnimationFrame( this.animationFrame );
		window.removeEventListener( 'keydown', this.preventBrowserScroll, true );
		this.pickTools?.dispose();
		this.puddleTransform?.dispose();
		this.resizeObserver?.disconnect();
		this.snowSystem.dispose();
		this.walk.dispose();
		this.floodLights?.dispose();
		this.lightShadows?.dispose();
		this.controls?.removeEventListener( 'start', this.stopAutoRotate );
		this.controls?.dispose();
		this.lighting.dispose();
		this.splat?.dispose();
		this.spark?.dispose();
		this.pmremGenerator?.dispose();
		this.sunLight?.dispose();
		this.rainEffect?.dispose();
		this.snowEffect?.dispose();
		this.colliderSnow?.dispose();
		this.puddlePatchSystem?.dispose();
		this.debugGui?.dispose();
		this.weatherAudio?.dispose();
		disposeColliderDepthOccluder( this.colliderDepth );
		disposeColliderDepthOccluder( this.colliderWireframe );
		this.sky?.geometry.dispose();
		this.sky?.material.dispose();
		this.renderer?.dispose();
		this.renderer?.domElement.remove();
	}

	private createRenderer() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera( 55, 1, 0.01, 1000 );
		this.renderer = new THREE.WebGLRenderer( { antialias: false, powerPreference: 'high-performance' } );
		this.renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 0.1;
		this.renderer.domElement.setAttribute( 'aria-label', '湘学联 3DGS 天气场景' );
		this.stage.appendChild( this.renderer.domElement );
	}

	private createEnvironment() {
		if ( ! this.scene || ! this.renderer ) {
			return;
		}

		this.sky = new ThunderSky();
		const reveal = SCENE_EFFECT_CONFIG.reveal;
		this.sky.material.uniforms[ 'revealProgress' ].value = 0;
		this.sky.material.uniforms[ 'revealGlowColor' ].value.setRGB( ...reveal.glowColor );
		this.sky.material.uniforms[ 'revealGlowStrength' ].value = reveal.glowStrength;
		this.sky.scale.setScalar( 45000 );
		this.sky.renderOrder = - 2000;
		this.sky.visible = false;
		this.scene.add( this.sky );

		this.weatherAudio = new WeatherAudio();
		this.lightningStorm = new LightningStorm( this.sky, () => this.weatherAudio?.playThunder() );
		this.lightningStorm.setEnabled( this.rainEnabled );

		const { direction, aboveHorizon } = sunDirectionFromTimeOfDay( this.timeOfDay );
		this.sky.material.uniforms[ 'sunPosition' ].value.copy( direction );
		this.sky.material.uniforms[ 'moonDirection' ].value.copy( direction ).multiplyScalar( - 1 );

		this.pmremGenerator = new THREE.PMREMGenerator( this.renderer );
		this.sunLight = new SunLight( 0xffffff, this.lighting.resolveSunLightIntensity( aboveHorizon ) );
		this.sunLight.position.copy( direction );
		this.sunLight.castShadow = this.lightingEnabled && ! this.lighting.isOvercast() && aboveHorizon;
		this.sunLight.shadow.mapSize.setScalar( 4096 );
		this.sunLight.shadow.camera.near = SUN_SHADOW_NEAR;
		this.sunLight.shadow.camera.far = SUN_SHADOW_FAR;
		this.sunLight.shadow.bias = - 0.0005;
		this.sunLight.shadow.normalBias = SUN_SHADOW_NORMAL_BIAS;
		this.scene.add( this.sunLight );

		this.ambientLight = new THREE.AmbientLight( 0xffffff, 0 );
		this.scene.add( this.ambientLight );
		this.floodLights = new SceneFloodLights( this.scene );
		this.lightShadows = new ColliderLightShadows();
		this.renderer.shadowMap.enabled = this.lightingEnabled && ! this.lighting.isOvercast();

		const weather = SCENE_EFFECT_CONFIG.weather;
		const weatherCenter = new THREE.Vector3( ...weather.center );
		const weatherSize = new THREE.Vector3( ...weather.size );
		const rain = SCENE_EFFECT_CONFIG.rain;
		this.rainEffect = new RainEffect( {
			count: rain.count,
			splashCount: rain.splashCount,
			splashScale: rain.splashScale,
			fallSpeed: rain.fallSpeed,
			wind: rain.wind,
			splashTexture: new THREE.TextureLoader().load( asset( 'textures/weather/Splash.png' ) )
		} );
		this.rainEffect.group.position.set( ...rain.position );
		this.rainEffect.group.scale.setScalar( rain.scale );
		this.rainEffect.setEnabled( this.rainEnabled );
		this.snowEffect = new SnowEffect();
		this.snowEffect.setBounds( weatherCenter, weatherSize, weather.snowCount );
		this.snowEffect.setEnabled( this.snowEnabled );
		this.scene.add( this.rainEffect.group );
		this.scene.add( this.snowEffect.points );

		this.puddlePatchSystem = new PuddlePatchSystem( {
			patches: PUDDLE_PATCHES,
			rainProgress: this.rainEffect.getRainProgress(),
			opacity: SCENE_EFFECT_CONFIG.puddle.opacity,
			coverage: SCENE_EFFECT_CONFIG.puddle.coverage,
			puddleScale: SCENE_EFFECT_CONFIG.puddle.puddleScale,
			edgeSoftness: SCENE_EFFECT_CONFIG.puddle.edgeSoftness,
			rippleScale: SCENE_EFFECT_CONFIG.puddle.rippleScale,
			roughness: SCENE_EFFECT_CONFIG.puddle.roughness,
			reflectionBlur: SCENE_EFFECT_CONFIG.puddle.reflectionBlur,
			reflectionStrength: SCENE_EFFECT_CONFIG.puddle.reflectionStrength,
			hideObjects: [ this.rainEffect.group, this.snowEffect.points ]
		} );
		this.puddlePatchSystem.setRippleStrength( SCENE_EFFECT_CONFIG.puddle.rippleStrength );
		this.puddlePatchSystem.setEnabled( this.rainEnabled );
		this.scene.add( this.puddlePatchSystem.group );
		this.rainEffect.setSplashSurfaces(
			this.puddlePatchSystem.getSurfaceGroup(), this.puddlePatchSystem.getCoverageUniforms()
		);

		this.spark = new SparkRenderer( { renderer: this.renderer } );
		this.scene.add( this.spark );
		this.lighting.applySkyWeather();
		this.lighting.syncCharacterAmbient();
		this.lighting.syncSnowLighting();
		this.lighting.syncWeatherAudio();
	}

	private createControls() {
		if ( ! this.camera || ! this.renderer ) {
			return;
		}

		this.controls = new OrbitControls( this.camera, this.renderer.domElement );
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.07;
		this.controls.autoRotate = true;
		this.controls.autoRotateSpeed = 1;
		this.controls.minPolarAngle = 0;
		this.controls.maxPolarAngle = Math.PI / 2;
		this.controls.addEventListener( 'start', this.stopAutoRotate );
		this.walk.setOverviewCamera( this.scene!, this.camera, this.controls );
	}

	private report( progress = this.progress, error?: string ) {
		this.progress = Math.max( this.progress, progress );
		if ( error ) {
			this.error = error;
		}

		this.onStatus( {
			progress: this.progress,
			ready: this.splatReady,
			walkReady: this.walkReady,
			error: this.error || undefined
		} );
	}

	private async resolveAssetSizes() {
		const assets: Array<[ LoadingAssetKey, string ]> = [
			[ 'model', MODEL_URL ],
			[ 'collider', COLLIDER_URL ],
			[ 'character', CHARACTER_URL ]
		];

		await Promise.all( assets.map( async ( [ key, url ] ) => {
			try {
				const response = await fetch( url, { method: 'HEAD' } );
				const total = Number( response.headers.get( 'content-length' ) );
				if ( response.ok && Number.isFinite( total ) && total > 0 ) {
					this.loadingAssets[ key ].total = total;
				}
			} catch {
				// 静态服务不支持 HEAD 请求时，使用预设资源大小计算下载进度。
			}
		} ) );
	}

	private updateAssetProgress( key: LoadingAssetKey, event: ProgressEvent<EventTarget> ) {
		const assetProgress = this.loadingAssets[ key ];
		if ( event.total > 0 ) {
			assetProgress.total = event.total;
		}
		assetProgress.loaded = Math.min( event.loaded, assetProgress.total );
		this.reportLoadingProgress();
	}

	private completeAsset( key: LoadingAssetKey ) {
		this.loadingAssets[ key ].loaded = this.loadingAssets[ key ].total;
		this.reportLoadingProgress();
	}

	private reportLoadingProgress() {
		// 加载页只等待 SOG 下载和解码，人物与碰撞资源不阻塞开场。
		const model = this.loadingAssets.model;
		const downloadProgress = model.total > 0 ? model.loaded / model.total : 0;
		this.report( this.splatReady ? 100 : Math.round( downloadProgress * SPLAT_DOWNLOAD_PROGRESS_SHARE ) );
	}

	private async loadSplat() {
		if ( ! this.scene ) {
			return;
		}

		this.splat = new SplatMesh( {
			url: MODEL_URL,
			onProgress: ( event ) => {
				this.updateAssetProgress( 'model', event );
			}
		} );
		this.splat.position.set( ...MODEL_POSITION );
		this.splat.rotation.set( ...MODEL_ROTATION );
		this.splat.scale.set( ...MODEL_SCALE );
		this.splatReveal = bindSplatSphereReveal( this.splat );
		this.scene.add( this.splat );
		await this.splat.initialized;

		if ( this.disposed ) {
			return;
		}

		this.completeAsset( 'model' );
		this.syncDebugGui();
		this.splatReveal.onComplete = () => {
			this.enableSplatLightingAfterReveal();
			this.skyRevealElapsed = 0;
			if ( this.sky ) {
				this.sky.visible = this.skyEnabled;
			}
		};
		this.splatReady = true;
		this.reportLoadingProgress();
	}

	private async loadWalkAssets() {
		if ( ! this.scene ) {
			return;
		}

		const loader = createGltfLoader();
		const collider = await loader.loadAsync( COLLIDER_URL, ( event ) => {
			this.updateAssetProgress( 'collider', event );
		} );
		this.completeAsset( 'collider' );
		this.colliderRoot = collider.scene;
		this.colliderRoot.position.set( ...MODEL_POSITION );
		this.colliderRoot.rotation.set( ...MODEL_ROTATION );
		this.colliderRoot.scale.set( ...MODEL_SCALE );
		this.colliderRoot.updateMatrixWorld( true );
		bindColliderShadowReceivers( this.colliderRoot, 0.4 );
		this.scene.add( this.colliderRoot );
		this.colliderDepth = createColliderDepthOccluder( this.colliderRoot );
		this.scene.add( this.colliderDepth );
		this.puddlePatchSystem?.addHideObject( this.colliderDepth );
		const { deform: groundSnowDeform, ...groundSnowParams } = SCENE_EFFECT_CONFIG.groundSnow;
		this.colliderSnow = new ColliderSnowAccumulation( this.colliderRoot, {
			...groundSnowParams,
			deformStrength: groundSnowDeform.strength
		} );
		this.colliderSnow.setEnabled( this.snowEnabled );
		this.snowSystem.setColliderSnow( this.colliderSnow );
		this.scene.add( this.colliderSnow.group );
		this.puddlePatchSystem?.addHideObject( this.colliderSnow.group );
		if ( this.snowEnabled ) {
			this.snowSystem.setEnabled( true, this.renderer );
		}
		this.syncColliderDepthVisible();
		this.syncColliderWireframe();
		this.syncDebugGui();

		await this.walk.loadCharacter( ( event ) => this.updateAssetProgress( 'character', event ) );
		this.completeAsset( 'character' );
		this.walkReady = true;
		this.reportLoadingProgress();
	}

	private async ensurePlayerInit() {
		if ( ! this.scene || ! this.camera || ! this.controls || ! this.colliderRoot ) {
			return;
		}
		await this.walk.ensureInit( {
			scene: this.scene,
			camera: this.camera,
			controls: this.controls,
			colliderRoot: this.colliderRoot,
			renderer: this.renderer,
			stageSize: new THREE.Vector2( this.stage.clientWidth, this.stage.clientHeight ),
			onFootSnowReady: ( player ) => this.snowSystem.ensureFootSnow( player ),
			onVehicleReady: ( group ) => {
				this.snowSystem.setVehicleGroup( group );
				this.snowSystem.ensureVehicleSnow();
				if ( this.snowEnabled ) {
					this.snowSystem.setEnabled( true, this.renderer );
				}
			}
		} );
		this.walk.syncCapsuleVisible( this.debugEnabled );
	}

	private async enterWalk() {
		if ( ! this.walkReady ) {
			return;
		}

		try {
			await this.ensurePlayerInit();
		} catch ( error ) {
			const message = error instanceof Error ? error.message : t( 'ui.unknownError' );
			this.report( this.progress, message );
			return;
		}

		if ( this.mode !== 'walk' || ! this.scene || ! this.camera || ! this.controls ) {
			return;
		}

		this.walk.enterWalk( this.scene, this.camera, this.controls );
	}

	private syncColliderDepthVisible() {
		syncColliderDepthMode( {
			colliderDepth: this.colliderDepth,
			meshDepthOcclusionEnabled: this.meshDepthOcclusionEnabled,
			rainEnabled: this.rainEnabled,
			snowEnabled: this.snowEnabled,
			waterVisible: Boolean( this.puddlePatchSystem?.isWaterVisible() )
		} );
	}

	private syncColliderWireframe() {
		const visible = this.debugEnabled && this.colliderWireframeVisible;
		if ( visible && ! this.colliderWireframe && this.colliderRoot && this.scene ) {
			this.colliderWireframe = createColliderWireframe( this.colliderRoot );
			this.scene.add( this.colliderWireframe );
			this.puddlePatchSystem?.addHideObject( this.colliderWireframe );
		}
		if ( this.colliderWireframe ) this.colliderWireframe.visible = visible;
	}

	private syncDebugGui() {
		if ( ! this.debugEnabled ) {
			this.debugGui?.dispose();
			this.debugGui = undefined;
			return;
		}
		this.debugGui ??= new SceneDebugGui( this.stage );
		this.debugGui.bind( {
			collider: {
				visible: this.colliderWireframeVisible,
				meshOcclusion: this.meshDepthOcclusionEnabled,
				onVisibleChange: ( visible ) => {
					this.colliderWireframeVisible = visible;
					this.syncColliderWireframe();
				},
				onMeshOcclusionChange: ( enabled ) => this.setMeshDepthOcclusion( enabled )
			},
			player: {
				capsuleVisible: this.walk.playerCapsuleVisible,
				onCapsuleVisibleChange: ( visible ) => {
					this.walk.playerCapsuleVisible = visible;
					this.walk.syncCapsuleVisible( this.debugEnabled );
				}
			},
			groundSnow: this.colliderSnow ?? null,
			rain: this.rainEffect ?? null,
			puddlePatchSystem: this.puddlePatchSystem ?? null,
			onPuddleVisibilityChange: () => this.syncColliderDepthVisible(),
			puddleTransform: this.puddlePatchSystem && this.puddleTransform ? {
				enabledPatchIndex: this.puddleTransform.enabledPatchIndex,
				mode: this.puddleTransform.mode,
				onEnabledChange: ( index, enabled ) => this.puddleTransform?.setEnabled( index, enabled ),
				onModeChange: ( mode ) => this.puddleTransform?.setMode( mode )
			} : null,
			pick: this.pickTools ? {
				armed: this.pickTools.armed,
				status: this.pickTools.status,
				lines: this.pickTools.lines(),
				onArmedChange: ( armed ) => this.pickTools?.setArmed( armed, this.controls ),
				onClear: () => this.pickTools?.clear(),
				onCopy: () => void this.pickTools?.copy()
			} : null,
			flood: this.floodLights ? {
				lights: this.floodLights.lights,
				night: isNightTimeOfDay( this.timeOfDay ),
				occlusion: this.lightOcclusionEnabled,
				onOcclusionChange: ( enabled ) => {
					this.lightOcclusionEnabled = enabled;
					this.lighting.syncLightOcclusion();
				},
				onAdd: () => this.addFloodLightFromPick(),
				onRemove: ( index ) => {
					this.floodLights?.remove( index );
					this.lighting.syncFloodLights();
					this.syncDebugGui();
				},
				onChange: () => this.lighting.syncFloodLights( true )
			} : null
		} );
		this.pickTools?.setGui( this.debugGui );
	}

	private addFloodLightFromPick() {

		const last = this.pickTools?.points[ this.pickTools.points.length - 1 ];
		const light = this.floodLights?.add( last );

		if ( ! light ) {

			this.pickTools?.setStatus( { key: 'pick.lightLimit', values: { count: FLOOD_LIGHT_LIMIT } } );
			return;

		}

		this.lighting.syncFloodLights();
		this.syncDebugGui();

	}

	private enableSplatLightingAfterReveal() {
		if ( this.disposed || ! this.splat ) {
			return;
		}
		this.lighting.attachAfterReveal( this.splat );
	}

	private resize() {
		if ( ! this.camera || ! this.renderer ) {
			return;
		}
		const width = Math.max( 1, Math.round( this.stage.clientWidth ) );
		const height = Math.max( 1, Math.round( this.stage.clientHeight ) );
		if ( width < 2 || height < 2 ) {
			return;
		}
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( width, height, false );
		this.walk.vehicleHeadlights?.setSize( width, height );
		const ratio = this.renderer.getPixelRatio();
		this.puddlePatchSystem?.setReflectionSize( Math.round( width * ratio * 0.75 ), Math.round( height * ratio * 0.75 ) );
	}

	private startAnimationLoop() {
		if ( this.animationFrame || this.disposed ) {
			return;
		}
		this.previousTime = performance.now();
		this.animationFrame = requestAnimationFrame( this.animate );
	}

	private animate = ( time: number ) => {
		if ( this.disposed || ! this.renderer || ! this.scene || ! this.camera ) {
			this.animationFrame = 0;
			return;
		}
		const delta = Math.min( Math.max( ( time - this.previousTime ) / 1000, 0 ), 0.1 );
		this.previousTime = time;
		this.resize();
		if ( this.mode === 'walk' && this.walk.playerInited && this.walk.player ) {
			void this.walk.player.update( delta );
		} else {
			this.controls?.update( delta );
		}
		this.rainEffect?.update( this.camera, delta );
		this.snowEffect?.update( this.camera, delta );
		this.colliderSnow?.update( delta );
		this.snowSystem.update(
			delta,
			this.renderer,
			this.mode,
			this.walk.playerInited,
			this.walk.player
		);
		this.lightningStorm?.update( this.camera, delta );
		this.walk.updateHeadlights();
		this.lighting.syncSplatHeadlights();
		this.lighting.syncLightOcclusion();
		if ( this.sky ) {
			this.sky.material.uniforms[ 'time' ].value = time * 0.001;
			if ( this.skyRevealElapsed !== undefined ) {
				this.skyRevealElapsed = Math.min( this.skyRevealDuration, this.skyRevealElapsed + delta );
				this.sky.material.uniforms[ 'revealProgress' ].value = this.skyRevealElapsed / this.skyRevealDuration;
			}
		}
		// 先推进已启动的天空动画，保证高斯点归位的这一帧仍保持天空初始状态。
		if ( this.splat && this.splatReveal ) {
			this.splatReveal.update( delta );
		}
		this.puddlePatchSystem?.update( delta );
		this.puddlePatchSystem?.updateReflection( this.renderer, this.scene, this.camera );
		this.renderScene();
		this.animationFrame = requestAnimationFrame( this.animate );
	};

	private renderScene() {
		if ( ! this.renderer || ! this.scene || ! this.camera ) {
			return;
		}
		renderWithMeshDepthPass( {
			renderer: this.renderer,
			scene: this.scene,
			camera: this.camera,
			colliderDepth: this.colliderDepth,
			overlays: [
				this.colliderDepth,
				this.colliderRoot,
				this.colliderSnow?.group,
				this.colliderWireframe,
				this.rainEffect?.group,
				this.snowEffect?.points,
				this.puddlePatchSystem?.group,
				this.walk.playerModel,
				this.walk.sceneVehicleGroup,
				this.pickTools?.getMarkers(),
				this.puddleTransform?.getHelper()
			],
			baseLayer: [ this.splat, this.spark, this.sky ]
		} );
	}

	private preventBrowserScroll = ( event: KeyboardEvent ) => {
		if ( ( event.target as HTMLElement | null )?.closest( 'input, select, textarea, button, [contenteditable="true"]' ) ) return;
		if ( this.mode === 'walk' && SCROLL_KEY_CODES.has( event.code ) ) {
			event.preventDefault();
		}
	};
}
