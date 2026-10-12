// 加载可控车辆，统一模型尺度、物理参数和车灯挂载。

import * as THREE from 'three';
import { playerController, type VehicleInstance } from 'three-player-controller';
import { createGltfLoader } from '../gltfLoader';
import { PLAYER_MODEL_SCALE } from '../sceneScale';
import { attachVehicleHeadlights } from './vehicleHeadlights';

export { PLAYER_MODEL_SCALE } from '../sceneScale';

const asset = ( path: string ) => `${ import.meta.env.BASE_URL }${ path }`;
/** 场景轿车模型地址。 */
export const VEHICLE_URL = asset( 'vehicles/sedan.glb' );

/** 控制器示例的人物缩放参考值，用于折算车辆参数尺度。 */
const EXAMPLE_CHARACTER_SCALE = 0.001;
const SCENE_SCALE = PLAYER_MODEL_SCALE / EXAMPLE_CHARACTER_SCALE;
/** 与 player.loadVehicleModel 的 scale 一致。 */
export const VEHICLE_MODEL_SCALE = 0.1 * SCENE_SCALE;
const VEHICLE_BESIDE = new THREE.Vector3( 0, - 0.47, - 0.5 ).multiplyScalar( SCENE_SCALE );

/** 来自 three-player-controller example/glTF.js 的轿车参数。 */
const VEHICLE_TUNING = {
	followVehicleDirection: true,
	debug: {
		showPhysicsBox: false,
		showWheelRays: false,
		showWheelTravel: false,
		showWheelSpheres: false
	},
	chassis: {
		density: 1,
		linearDamping: 0.05,
		angularDamping: 0.5,
		clearance: 0.25,
		sizeScale: { x: 0.9, y: 0.65, z: 0.9 }
	},
	suspension: {
		restLength: 0.15,
		maxTravel: 0.15,
		stiffness: 25,
		compression: 2.1,
		relaxation: 2.5,
		maxForce: 6000,
		frictionSlip: 8,
		sideFrictionStiffness: 1,
		rollInfluence: 0.12
	},
	steering: {
		maxSteerAngle: Math.PI / 5,
		steerTime: 0.45,
		steerReturnTimeSlow: 0.55,
		steerReturnTimeFast: 0.4,
		highSpeedSteerScale: 0.3
	},
	grip: {
		maxG: 1.2,
		sideFrictionIdle: 1,
		sideFrictionFrontMin: 0.55,
		sideFrictionRearMin: 0.45,
		handbrakeRearFriction: 0.35,
		handbrakeRearDriveScale: 0.65,
		handbrakeReleaseTime: 0.15,
		wheelbaseRatio: 0.55
	},
	power: {
		maxSpeed: 100,
		acceleration: 5,
		deceleration: 5
	}
};

const applyVehicleMeshStyle = ( root: THREE.Object3D ) => {

	root.traverse( ( child ) => {

		if ( ! ( child instanceof THREE.Mesh ) ) {

			return;

		}

		child.castShadow = true;
		child.receiveShadow = true;

		if ( /headlight|taillight/i.test( child.name ) ) {

			return;

		}

		const materials = Array.isArray( child.material ) ? child.material : [ child.material ];

		materials.forEach( ( material ) => {

			if ( ! ( material instanceof THREE.MeshStandardMaterial ) ) {

				return;

			}

			material.metalness = 0.8;
			material.roughness = 0;

		} );

	} );

};

const applyVehicleTuning = ( player: playerController, vehicle: VehicleInstance ) => {

	const tuning = VEHICLE_TUNING;
	player.setVehicleChassisSizeScale( vehicle, tuning.chassis.sizeScale );
	player.setVehicleClearance( vehicle, tuning.chassis.clearance );

	const half = vehicle.halfExtents;
	const volume = 8 * half.x * half.y * half.z;
	vehicle.chassisBody.setMass( volume * Math.max( 1e-8, tuning.chassis.density ) );
	vehicle.chassisBody.linearDamping = tuning.chassis.linearDamping;
	vehicle.chassisBody.angularDamping = tuning.chassis.angularDamping;

	Object.assign( vehicle.steering, tuning.steering );
	Object.assign( vehicle.grip, tuning.grip );
	vehicle.maxSpeed = tuning.power.maxSpeed * vehicle.scale;
	vehicle.acceleration = tuning.power.acceleration * vehicle.scale;
	vehicle.deceleration = tuning.power.deceleration * vehicle.scale;
	vehicle.followVehicleDirection = tuning.followVehicleDirection;

	const suspension = tuning.suspension;
	const staticSag = 9.81 * vehicle.scale / ( 4 * Math.max( 1e-4, suspension.stiffness ) );
	const rest = Math.max( suspension.restLength * vehicle.scale, staticSag * 1.2 );
	vehicle.sideFrictionStiffness = suspension.sideFrictionStiffness;

	const wheelCount = vehicle.vehicleController.numWheels();

	for ( let index = 0; index < wheelCount; index ++ ) {

		vehicle.vehicleController.setWheelSuspensionRestLength( index, rest );
		vehicle.vehicleController.setWheelMaxSuspensionTravel( index, suspension.maxTravel * vehicle.scale );
		vehicle.vehicleController.setWheelSuspensionStiffness( index, suspension.stiffness );
		vehicle.vehicleController.setWheelSuspensionCompression( index, suspension.compression );
		vehicle.vehicleController.setWheelSuspensionRelaxation( index, suspension.relaxation );
		vehicle.vehicleController.setWheelMaxSuspensionForce( index, suspension.maxForce );
		vehicle.vehicleController.setWheelFrictionSlip( index, suspension.frictionSlip );
		vehicle.vehicleController.setWheelSideFrictionStiffness( index, suspension.sideFrictionStiffness );
		vehicle.vehicleController.setWheelRollInfluence( index, suspension.rollInfluence );

	}

};

/**
 * 在人物出生点旁加载并注册可控轿车，应用统一的车辆物理参数。
 *
 * @param player - 已初始化的人物控制器。
 * @param url - 车辆模型地址。
 * @param spawn - 人物出生点。
 */
export const spawnSceneVehicle = async ( player: playerController, url: string, spawn: THREE.Vector3 ) => {

	const gltf = await createGltfLoader().loadAsync( url );

	await player.loadVehicleModel( {
		model: gltf.scene,
		scale: VEHICLE_MODEL_SCALE,
		wheelsNames: [ 'Wheel_LF', 'Wheel_RF', 'Wheel_LR', 'Wheel_RR' ],
		followVehicleDirection: VEHICLE_TUNING.followVehicleDirection,
		debug: VEHICLE_TUNING.debug,
		chassis: VEHICLE_TUNING.chassis,
		suspension: VEHICLE_TUNING.suspension,
		steering: VEHICLE_TUNING.steering,
		grip: VEHICLE_TUNING.grip,
		power: VEHICLE_TUNING.power,
		driverSeatPosition: new THREE.Vector3( - 0.5, 1.0, 0.4 ),
		driverSeatRotation: - Math.PI / 2,
		position: spawn.clone().add( VEHICLE_BESIDE )
	} );

	const vehicles = player.getAllVehicles();
	const vehicle = vehicles[ vehicles.length - 1 ];

	if ( ! vehicle ) {

		return undefined;

	}

	applyVehicleMeshStyle( vehicle.vehicleGroup );
	applyVehicleTuning( player, vehicle );
	return vehicle;

};

/**
 * 在已生成的车辆上挂近光灯与体积光锥。
 *
 * @param vehicle - 已加载车辆。
 * @param camera - 当前场景相机。
 * @param resolution - 画布 CSS 像素尺寸。
 */
export const mountSceneVehicleHeadlights = (
	vehicle: VehicleInstance,
	camera: THREE.PerspectiveCamera,
	resolution: THREE.Vector2
) => attachVehicleHeadlights( vehicle, camera, resolution );
