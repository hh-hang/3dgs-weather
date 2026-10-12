// 管理人物和车辆初始化，以及环视、步行与驾驶之间的相机和输入切换。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { playerController } from 'three-player-controller';
import { createGltfLoader } from '../gltfLoader';
import { SCENE_EFFECT_CONFIG } from '../sceneEffectConfig';
import { PLAYER_MODEL_SCALE } from '../sceneScale';
import { isNightTimeOfDay } from '../lighting/splatLighting';
import {
	mountSceneVehicleHeadlights,
	spawnSceneVehicle,
	VEHICLE_URL
} from './sceneVehicle';
import type { VehicleHeadlights } from './vehicleHeadlights';

const asset = ( path: string ) => `${ import.meta.env.BASE_URL }${ path }`;
/** 漫游人物模型地址。 */
export const CHARACTER_URL = asset( 'character/character.glb' );

/** 环视初始：注视点，以及相对注视点的相机偏移。 */
export const OVERVIEW_CAMERA_TARGET: [ number, number, number ] = [ - 20.2, - 40, - 13 ];
/** 环视相机相对注视点的世界坐标偏移。 */
export const OVERVIEW_CAMERA_OFFSET: [ number, number, number ] = [ - 30, 10, 0 ];
/** 人物初始出生点的世界坐标。 */
export const SPAWN_POSITION: [ number, number, number ] = [ 2.7, - 35, 12.6 ];
/** 步行第一人称相机偏移，使用人物控制器的参考尺度。 */
export const FIRST_PERSON_OFFSET_WALK: [ number, number, number ] = [ 0, 15, 0 ];
/** 驾驶第一人称相机偏移，使用人物控制器的参考尺度。 */
export const FIRST_PERSON_OFFSET_DRIVE: [ number, number, number ] = [ 0, - 30, 0 ];

/** 漫游会话的观察模式：环视或漫游。 */
export type WalkViewerMode = 'view' | 'walk';
/** 操作提示模式：步行或驾驶。 */
export type ControlHintMode = 'on-foot' | 'vehicle';

/** 漫游会话读取场景状态和同步外部状态的回调。 */
export type WalkSessionHooks = {
	/** 读取当前观察模式。 */
	getMode: () => WalkViewerMode;
	/** 读取归一化时刻，范围为 0–1。 */
	getTimeOfDay: () => number;
	/** 判断场景是否已销毁。 */
	isDisposed: () => boolean;
	/** 车灯状态变化后同步高斯点光照。 */
	onHeadlightsSync: () => void;
	/** 步行或驾驶状态变化后同步操作提示。 */
	onControlHintMode: ( mode: ControlHintMode ) => void;
};

/** 管理人物和车辆资源，协调漫游初始化与相机切换。 */
export class WalkSession {

	/** 人物控制器，人物资源加载后创建。 */
	player?: playerController;
	/** 漫游人物模型。 */
	playerModel?: THREE.Object3D;
	/** 人物模型携带的动画片段。 */
	playerAnimations: THREE.AnimationClip[] = [];
	/** 当前可控车辆的车灯系统。 */
	vehicleHeadlights?: VehicleHeadlights;
	/** 当前场景中的可控车辆。 */
	sceneVehicleGroup?: THREE.Object3D;
	/** 人物控制器与静态碰撞索引是否完成初始化。 */
	playerInited = false;
	/** 人物胶囊体的调试显示设置。 */
	playerCapsuleVisible = false;
	private initTask?: Promise<void>;

	constructor( private readonly hooks: WalkSessionHooks ) {}

	/** 加载人物模型和动画，创建尚未初始化的控制器。 */
	async loadCharacter(
		onProgress: ( event: ProgressEvent<EventTarget> ) => void
	) {

		const loader = createGltfLoader();
		const character = await loader.loadAsync( CHARACTER_URL, onProgress );
		this.playerModel = character.scene;
		this.playerAnimations = character.animations;
		this.playerModel.traverse( ( object ) => {

			object.castShadow = true;
			object.receiveShadow = true;

		} );
		this.playerModel.visible = false;
		this.player = new playerController();

	}

	/** 复用首次漫游初始化任务，等待碰撞索引并创建可控车辆。 */
	async ensureInit( deps: {
		/** 漫游对象挂载的主场景。 */
		scene: THREE.Scene;
		/** 漫游与环视共用的透视相机。 */
		camera: THREE.PerspectiveCamera;
		/** 切换漫游时需暂停的环视控制器。 */
		controls: OrbitControls;
		/** 用于建立静态碰撞索引的场景碰撞体。 */
		colliderRoot: THREE.Object3D;
		/** 主渲染器，尚未创建时可为空。 */
		renderer: THREE.WebGLRenderer | undefined;
		/** 画布宽高，单位为 CSS 像素。 */
		stageSize: THREE.Vector2;
		/** 碰撞索引就绪后创建鞋底压雪采样器。 */
		onFootSnowReady: ( player: playerController ) => void;
		/** 可控车辆加载完成后同步外部系统。 */
		onVehicleReady: ( group: THREE.Object3D ) => void;
	} ) {

		if ( this.playerInited ) {

			return;

		}

		if ( this.initTask ) {

			return this.initTask;

		}

		if ( ! this.player || ! this.playerModel ) {

			return;

		}

		const { scene, camera, controls, colliderRoot } = deps;
		const player = this.player;
		const playerModel = this.playerModel;

		this.initTask = ( async () => {

			const initPos = new THREE.Vector3().fromArray( SPAWN_POSITION );
			await player.init( {
				scene,
				camera,
				controls,
				initPos,
				isFirstPerson: false,
				isShowMobileControls: true,
				mouseSensitivity: 4,
				minCamDistance: 20,
				maxCamDistance: 600,
				enableZoom: true,
				enableSpringCamera: true,
				enableOverShoulderView: true,
				camOverShoulderOffsetRatio: 0.1,
				camLookAtHeightRatio: 0.7,
				colliders: [ {
					motion: 'static',
					shape: { kind: 'mesh', source: colliderRoot }
				} ],
				playerModelConfig: {
					model: playerModel,
					animations: this.playerAnimations,
					scale: PLAYER_MODEL_SCALE,
					idleAnim: 'idle',
					walkAnim: 'walk',
					runAnim: 'run',
					jumpAnim: [ 'Jump_Start', 'Jump_Loop', 'Jump_Land' ],
					flyAnim: 'fly',
					flyIdleAnim: 'flyIdle',
					flyHoverForwardAnim: 'flyHoverForward',
					flyHoverBackAnim: 'flyHoverBack',
					flyHoverLeftAnim: 'flyHoverLeft',
					flyHoverRightAnim: 'flyHoverRight',
					flyHoverUpAnim: 'flyHoverUp',
					flyHoverDownAnim: 'flyHoverDown',
					drivingAnim: 'Driving_Loop',
					firstPersonCameraOffset: FIRST_PERSON_OFFSET_WALK,
					speed: 200,
					runSpeed: 420,
					jumpHeight: 700,
					gravity: - 2400,
					rotateY: - Math.PI / 2
				}
			} );

			player.setColliderDebug( false );
			player.onViewChange = ( firstPerson ) => {

				playerModel.visible = this.hooks.getMode() === 'walk' && ! firstPerson;

			};
			player.onVehicleEnter = () => {

				this.applyFirstPersonOffset( FIRST_PERSON_OFFSET_DRIVE );
				this.hooks.onControlHintMode( 'vehicle' );

			};
			player.onVehicleExit = () => {

				this.applyFirstPersonOffset( FIRST_PERSON_OFFSET_WALK );
				this.vehicleHeadlights?.update( false, isNightTimeOfDay( this.hooks.getTimeOfDay() ) );
				this.hooks.onHeadlightsSync();
				this.hooks.onControlHintMode( 'on-foot' );

			};
			window.addEventListener( 'keydown', this.onVehicleResetKey );

			await this.waitForCollider();
			deps.onFootSnowReady( player );
			this.playerInited = true;
			this.syncCapsuleVisible( this.hooks.getMode() === 'walk' );
			const vehicle = await spawnSceneVehicle( player, VEHICLE_URL, initPos );
			if ( vehicle ) {

				this.sceneVehicleGroup = vehicle.vehicleGroup;
				deps.onVehicleReady( this.sceneVehicleGroup );
				this.vehicleHeadlights = mountSceneVehicleHeadlights( vehicle, camera, deps.stageSize );

			}

		} )();

		return this.initTask;

	}

	/** 进入漫游，启用人物输入并恢复越肩相机。 */
	enterWalk( scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls ) {

		if ( ! this.player || ! this.playerInited ) {

			return;

		}

		if ( this.playerModel ) {

			this.playerModel.visible = true;

		}

		this.player.isFirstPerson = false;
		scene.attach( camera );
		controls.autoRotate = false;
		this.player.cam.initControls();
		this.player.cam.setOverShoulder( this.player.enableOverShoulderView );
		this.player.cam.setCamPos();
		this.player.onAllEvent();
		this.syncControlHintMode();

	}

	/** 退出漫游输入，隐藏人物并恢复环视相机。 */
	exitToOverview( scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls ) {

		if ( this.player && this.playerInited ) {

			this.player.offAllEvent();
			this.player.isFirstPerson = false;
			this.player.cam.resetControls();

		}

		if ( this.playerModel ) {

			this.playerModel.visible = false;

		}

		this.hooks.onControlHintMode( 'on-foot' );
		this.setOverviewCamera( scene, camera, controls );

	}

	/** 按人物是否处于载具模式同步步行或驾驶提示。 */
	syncControlHintMode() {

		const inVehicle = this.player?.controllerMode === 1 && Boolean( this.player.getActiveVehicle() );
		this.hooks.onControlHintMode( inVehicle ? 'vehicle' : 'on-foot' );

	}

	/** 恢复环视相机位置与控制参数，并清除越肩投影偏移和指针锁定。 */
	setOverviewCamera( scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls ) {

		scene.attach( camera );
		camera.clearViewOffset();
		controls.target.fromArray( OVERVIEW_CAMERA_TARGET );
		camera.position.set(
			OVERVIEW_CAMERA_TARGET[ 0 ] + OVERVIEW_CAMERA_OFFSET[ 0 ],
			OVERVIEW_CAMERA_TARGET[ 1 ] + OVERVIEW_CAMERA_OFFSET[ 1 ],
			OVERVIEW_CAMERA_TARGET[ 2 ] + OVERVIEW_CAMERA_OFFSET[ 2 ]
		);
		camera.up.set( 0, 1, 0 );
		controls.enabled = true;
		controls.enableZoom = true;
		controls.enablePan = true;
		controls.autoRotate = true;
		controls.maxDistance = SCENE_EFFECT_CONFIG.overview.maxDistance;
		controls.update( 0 );
		if ( document.pointerLockElement ) {

			void document.exitPointerLock();

		}

	}

	/** 设置第一人称相机偏移，已处于第一人称时立即更新视角。 */
	applyFirstPersonOffset( offset: [ number, number, number ] ) {

		if ( ! this.player ) {

			return;

		}

		this.player.playerModelConfig.firstPersonCameraOffset = offset;
		if ( this.player.getIsFirstPerson() ) {

			this.player.setFirstPersonCamera();

		}

	}

	/** 仅在调试启用且显示设置开启时显示人物胶囊体。 */
	syncCapsuleVisible( debugEnabled: boolean ) {

		if ( ! this.playerInited ) {

			return;

		}

		this.player?.setPlayerCapsuleDebug( debugEnabled && this.playerCapsuleVisible );

	}

	/** 按昼夜与驾驶刹车状态逐帧更新车灯。 */
	updateHeadlights() {

		const inVehicle = this.player?.controllerMode === 1 && Boolean( this.player.getActiveVehicle() );
		this.vehicleHeadlights?.update(
			Boolean( inVehicle && this.player?.input.space ),
			isNightTimeOfDay( this.hooks.getTimeOfDay() )
		);

	}

	private waitForCollider = async () => {

		const startedAt = performance.now();
		while ( ! this.hooks.isDisposed() && this.player && ! this.player.isStaticColliderUsable() ) {

			if ( performance.now() - startedAt > 120000 ) {

				throw new Error( '碰撞索引构建超时' );

			}

			await new Promise<void>( ( resolve ) => window.setTimeout( resolve, 100 ) );

		}

	};

	private onVehicleResetKey = ( event: KeyboardEvent ) => {

		if ( event.code !== 'KeyR' || event.repeat ) {

			return;

		}

		if ( this.hooks.getMode() !== 'walk' || this.player?.controllerMode !== 1 ) {

			return;

		}

		this.player.resetVehicle();

	};

	/** 移除车辆输入监听，销毁人物控制器与车灯。 */
	dispose() {

		window.removeEventListener( 'keydown', this.onVehicleResetKey );
		this.vehicleHeadlights?.dispose();
		this.player?.destroy();
		this.vehicleHeadlights = undefined;
		this.player = undefined;
		this.playerModel = undefined;
		this.sceneVehicleGroup = undefined;
		this.playerInited = false;
		this.initTask = undefined;

	}

}
