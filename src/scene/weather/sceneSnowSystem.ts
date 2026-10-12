// 协调地面积雪、脚印、车辙形变与车辆积雪。

import type * as THREE from 'three';
import type { playerController } from 'three-player-controller';
import { SCENE_EFFECT_CONFIG } from '../sceneEffectConfig';
import { ColliderSnowAccumulation } from './colliderSnowAccumulation';
import { FootSnowInteraction } from './footSnowInteraction';
import { SnowDeformMap } from './snowDeformMap';
import { VehicleSnowAccumulation } from './vehicleSnowAccumulation';

/** 场景观察模式：环视或漫游。 */
export type ViewerMode = 'view' | 'walk';

/** 协调地面积雪形变、脚印、车辙和车辆积雪。 */
export class SceneSnowSystem {

	private vehicleSnow?: VehicleSnowAccumulation;
	private snowDeformMap?: SnowDeformMap;
	private footSnow?: FootSnowInteraction;
	private sceneVehicleGroup?: THREE.Object3D;
	private snowEnabled = false;

	constructor( private colliderSnow?: ColliderSnowAccumulation ) {}

	/** 绑定地面积雪覆盖层。 */
	setColliderSnow( snow: ColliderSnowAccumulation | undefined ) {

		this.colliderSnow = snow;

	}

	/** 更换车辆积雪目标，并清理旧车积雪状态。 */
	setVehicleGroup( group: THREE.Object3D | undefined ) {

		if ( group === this.sceneVehicleGroup ) {

			return;

		}

		this.vehicleSnow?.dispose();
		this.vehicleSnow = undefined;
		this.sceneVehicleGroup = group;

	}

	/** 切换积雪交互，启用时按需创建形变图，关闭时清空压痕。 */
	setEnabled( enabled: boolean, renderer?: THREE.WebGLRenderer ) {

		this.snowEnabled = enabled;
		this.footSnow?.setEnabled( enabled );
		this.ensureVehicleSnow();
		this.vehicleSnow?.setEnabled( enabled );
		if ( enabled ) {

			this.ensureSnowDeformMap();

		} else if ( this.snowDeformMap && renderer ) {

			this.snowDeformMap.clear( renderer );

		}

	}

	/** 为已初始化的人物创建鞋底接触采样器。 */
	ensureFootSnow( player: playerController ) {

		this.footSnow ??= new FootSnowInteraction( player, this.snowEnabled );

	}

	/** 为当前车辆按需创建车身积雪效果。 */
	ensureVehicleSnow() {

		if ( this.vehicleSnow || ! this.sceneVehicleGroup ) {

			return;

		}

		this.vehicleSnow = new VehicleSnowAccumulation(
			this.sceneVehicleGroup,
			SCENE_EFFECT_CONFIG.vehicleSnow
		);
		if ( this.colliderSnow ) {

			const ground = this.colliderSnow.getParams();
			this.vehicleSnow.syncCoverageFrom(
				ground.coverage,
				this.colliderSnow.getIntro(),
				this.snowEnabled
			);

		} else {

			this.vehicleSnow.setEnabled( this.snowEnabled );

		}

	}

	private ensureSnowDeformMap() {

		if ( this.snowDeformMap || ! this.colliderSnow ) {

			return;

		}

		const weather = SCENE_EFFECT_CONFIG.weather;
		const deform = SCENE_EFFECT_CONFIG.groundSnow.deform;
		this.snowDeformMap = new SnowDeformMap( {
			center: weather.center,
			size: weather.size,
			resolution: deform.resolution,
			fadePerSecond: deform.fadePerSecond
		} );
		this.colliderSnow.setDeformMap( this.snowDeformMap );

	}

	/** 按帧间隔秒数同步车身积雪，并在漫游状态采样脚印与车辙、更新形变图。 */
	update(
		delta: number,
		renderer: THREE.WebGLRenderer | undefined,
		mode: ViewerMode,
		playerInited: boolean,
		player?: playerController
	) {

		if ( this.vehicleSnow && this.colliderSnow ) {

			const ground = this.colliderSnow.getParams();
			this.vehicleSnow.syncCoverageFrom(
				ground.coverage,
				this.colliderSnow.getIntro(),
				this.snowEnabled
			);

		} else {

			this.vehicleSnow?.update( delta );

		}

		this.updateSnowDeform( delta, renderer, mode, playerInited, player );

	}

	private updateSnowDeform(
		delta: number,
		renderer: THREE.WebGLRenderer | undefined,
		mode: ViewerMode,
		playerInited: boolean,
		player?: playerController
	) {

		if ( ! this.snowEnabled || ! renderer || ! this.snowDeformMap ) {

			return;

		}

		if ( mode === 'walk' && playerInited && player ) {

			this.queueSnowContactStamps( delta, player );

		} else {

			this.footSnow?.reset();

		}

		this.snowDeformMap.update( renderer, delta );
		this.colliderSnow?.setDeformMap( this.snowDeformMap );

	}

	private queueSnowContactStamps( delta: number, player: playerController ) {

		const map = this.snowDeformMap;
		if ( ! map ) {

			return;

		}

		const deform = SCENE_EFFECT_CONFIG.groundSnow.deform;
		const vehicle = player.getActiveVehicle();
		if ( player.controllerMode === 1 && vehicle ) {

			this.footSnow?.reset();
			const wheels = vehicle.vehicleController.wheels;
			for ( let i = 0; i < wheels.length; i ++ ) {

				const wheel = wheels[ i ];
				if ( ! wheel.isInContact ) {

					continue;

				}

				map.queueStamp( {
					x: wheel.contactPoint.x,
					z: wheel.contactPoint.z,
					radius: deform.tireRadius,
					strength: deform.stampStrength
				} );

			}
			return;

		}

		this.footSnow?.update( map, delta, deform );

	}

	/** 释放鞋底采样、车辆积雪与地面形变资源。 */
	dispose() {

		this.vehicleSnow?.dispose();
		this.footSnow?.dispose();
		this.snowDeformMap?.dispose();
		this.vehicleSnow = undefined;
		this.footSnow = undefined;
		this.snowDeformMap = undefined;

	}

}
