// 读取动画鞋底的地面接触，生成压雪笔刷并保持人物骨骼姿态。

import * as THREE from 'three';
import type { playerController } from 'three-player-controller';
import { FootIK, type FootIKSide } from 'three-player-controller/foot-ik';
import type { SnowDeformMap } from './snowDeformMap';

type SoleSample = {
	local: THREE.Vector3;
	hitPoint: THREE.Vector3;
	hasHit: boolean;
};

type IKLegRuntime = {
	ready: boolean;
	planted: boolean;
	foot: THREE.Bone;
	hitNormal: THREE.Vector3;
	soleSamples: SoleSample[];
	bestGroundSampleIndex: number;
};

type IKGroundRuntime = {
	legs?: Partial<Record<FootIKSide, IKLegRuntime>>;
	getMeshWorldHitNormal?: ( hit: THREE.Intersection, target: THREE.Vector3 ) => THREE.Vector3;
	syncDistanceScale?: () => void;
	updateFootPhaseRuntime?: () => void;
	refreshColliderMeshes?: () => void;
	isLocomotion?: () => boolean;
	castBestFootGround?: ( leg: IKLegRuntime ) => { normal: THREE.Vector3 } | null;
	footPhaseState?: Partial<Record<FootIKSide, { planted: boolean }>>;
};

type Four<T> = [ T, T, T, T ];

/** 单只鞋底四角的世界位置与实际接触权重。 */
export type FootSnowContact = {
	/** 鞋底四角世界坐标，顺序为后跟左、后跟右、脚尖左、脚尖右。 */
	corners: Four<THREE.Vector3>;
	/** 与四角坐标一一对应的接触权重，范围为 0–1。 */
	weights: Four<number>;
};

const isFiniteVector = ( value: unknown ): value is THREE.Vector3 => {
	const vector = value as THREE.Vector3 | undefined;
	return vector?.isVector3 === true
		&& Number.isFinite( vector.x ) && Number.isFinite( vector.y ) && Number.isFinite( vector.z );
};

/**
 * 兼容当前场景的双面地面，不修改控制器包或碰撞几何。
 * 仅对传入的场景碰撞网格统一朝上法线，车辆等后续注册的碰撞体保持原判定。
 */
export const adaptFootIKGround = ( ik: FootIK, sceneGroundMeshes: ReadonlySet<THREE.Object3D> ) => {
	const runtime = ik as unknown as IKGroundRuntime;
	const getNormal = runtime.getMeshWorldHitNormal;
	if ( typeof getNormal === 'function' ) {
		runtime.getMeshWorldHitNormal = ( hit, target ) => {
			const normal = getNormal.call( ik, hit, target );
			if ( sceneGroundMeshes.has( hit.object ) && normal.y < 0 ) normal.negate();
			return normal;
		};
	}
};

/** 关闭 IK 时独立更新接触数据；不调用 updateFoot、applyLeg 或 applyPelvis。 */
export const sampleFootSnowContacts = ( ik: FootIK ): boolean => {
	const runtime = ik as unknown as IKGroundRuntime;
	if ( typeof runtime.syncDistanceScale !== 'function' || typeof runtime.updateFootPhaseRuntime !== 'function'
		|| typeof runtime.refreshColliderMeshes !== 'function' || typeof runtime.isLocomotion !== 'function'
		|| typeof runtime.castBestFootGround !== 'function' ) return false;
	// 距离缩放、动画相位与射线检测均不改变骨骼姿态。
	runtime.syncDistanceScale();
	runtime.updateFootPhaseRuntime();
	runtime.refreshColliderMeshes();
	const moving = runtime.isLocomotion();
	for ( const side of [ 'left', 'right' ] as const ) {
		const leg = runtime.legs?.[ side ];
		if ( ! leg?.ready || ! leg.foot?.isBone || ! Array.isArray( leg.soleSamples ) || leg.soleSamples.length !== 4 ) continue;
		leg.planted = ! moving || runtime.footPhaseState?.[ side ]?.planted === true;
		if ( ! leg.planted ) {
			leg.bestGroundSampleIndex = -1;
			for ( const sample of leg.soleSamples ) sample.hasHit = false;
			continue;
		}
		const hit = runtime.castBestFootGround( leg );
		if ( hit ) leg.hitNormal.copy( hit.normal );
	}
	return true;
};

/**
 * three-player-controller 0.6.2 的内部数据适配边界。
 * 只读取接触字段；从当前动画骨骼变换计算脚底，不执行 IK 修正。
 * 缺少适配字段、处于摆腿阶段或未接触地面时返回 null。
 */
export const readFootSnowContact = (
	ik: FootIK,
	side: FootIKSide,
	tolerance: number
): FootSnowContact | null => {
	const runtime = ik as unknown as { legs?: Partial<Record<FootIKSide, IKLegRuntime>> };
	const leg = runtime.legs?.[ side ];
	if ( ! leg?.ready || leg.planted !== true || ! leg.foot?.isBone
		|| ! Array.isArray( leg.soleSamples ) || leg.soleSamples.length !== 4
		|| ! Number.isInteger( leg.bestGroundSampleIndex ) || leg.bestGroundSampleIndex < 0 || leg.bestGroundSampleIndex >= 4
		|| ! isFiniteVector( leg.hitNormal ) || ! Number.isFinite( tolerance ) || tolerance <= 0 ) {
		return null;
	}
	const normal = leg.hitNormal.clone();
	if ( normal.lengthSq() < 1e-8 ) return null;
	normal.normalize();
	if ( normal.y < 0.35 ) return null;
	leg.foot.updateWorldMatrix( true, false );
	const corners = [] as unknown as Four<THREE.Vector3>;
	const weights = [] as unknown as Four<number>;
	const offset = new THREE.Vector3();
	for ( let i = 0; i < 4; i ++ ) {
		const sample = leg.soleSamples[ i ];
		if ( ! sample || ! isFiniteVector( sample.local ) ) return null;
		const point = sample.local.clone().applyMatrix4( leg.foot.matrixWorld );
		if ( ! isFiniteVector( point ) ) return null;
		corners[ i ] = point;
		weights[ i ] = 0;
		if ( sample.hasHit === true && isFiniteVector( sample.hitPoint ) ) {
			const gap = offset.subVectors( point, sample.hitPoint ).dot( normal );
			weights[ i ] = 1 - THREE.MathUtils.smoothstep( Math.abs( gap ), tolerance * 0.35, tolerance );
		}
	}
	return weights.some( ( weight ) => weight > 0.05 ) ? { corners, weights } : null;
};

/** 鞋底压雪采样与盖印参数。 */
export type FootSnowOptions = {
	/** 相对动画鞋底尺寸的缩放倍率。 */
	footSizeScale: number;
	/** 鞋底与地面接触的距离容差，世界单位。 */
	footContactTolerance: number;
	/** 落脚后的压实渐入时间，单位为秒。 */
	footPressSeconds: number;
	/** 支撑脚滑动盖印的最小间距，世界单位。 */
	footStampSpacing: number;
	/** 笔刷压痕强度，范围为 0–1。 */
	stampStrength: number;
};

type FootPressure = {
	touching: boolean;
	seconds: number;
	position: THREE.Vector2;
	angle: number;
	strength: number;
	weights: Four<number>;
};

const createFootPressure = (): FootPressure => ( {
	touching: false,
	seconds: 0,
	position: new THREE.Vector2(),
	angle: 0,
	strength: 0,
	weights: [ 0, 0, 0, 0 ]
} );

/** 基于动画鞋底的实际接触压雪；Foot IK 始终关闭，降雪只控制采样和盖印。 */
export class FootSnowInteraction {
	private readonly ik: FootIK;
	private readonly feet = { left: createFootPressure(), right: createFootPressure() };
	private enabled: boolean;

	constructor( private readonly player: playerController, enabled: boolean ) {
		this.enabled = enabled;
		this.ik = new FootIK( { enabled: false } );
		// 初始化时只有场景静态碰撞；车辆在 WeatherScene 中稍后注册。
		adaptFootIKGround( this.ik, new Set( player.getColliderMeshes() ) );
		player.use( this.ik );
	}

	/** 切换鞋底压雪采样并清空接触状态。 */
	setEnabled( enabled: boolean ) {
		this.enabled = enabled;
		this.reset();
	}

	/** 清空双脚接触时间、压力与滑动盖印状态。 */
	reset() {
		for ( const foot of Object.values( this.feet ) ) {
			foot.touching = false;
			foot.seconds = 0;
		}
	}

	/** 按帧间隔秒数采样真实鞋底接触，累积压力并提交鞋底笔刷。 */
	update( map: Pick<SnowDeformMap, 'queueStamp'>, delta: number, options: FootSnowOptions ) {
		if ( ! this.enabled || this.player.getControllerMode() !== 0 || this.player.getIsFlying()
			|| ( ! this.player.playerIsOnGround && ! this.player.getIsOnGround() ) ) {
			this.reset();
			return;
		}
		if ( ! sampleFootSnowContacts( this.ik ) ) {
			this.reset();
			return;
		}
		const sides: FootIKSide[] = [ 'left', 'right' ];
		const contacts = sides.map( ( side ) => readFootSnowContact( this.ik, side, options.footContactTolerance ) );
		const contactCount = contacts.filter( Boolean ).length;
		for ( let i = 0; i < sides.length; i ++ ) {
			const state = this.feet[ sides[ i ] ];
			const contact = contacts[ i ];
			if ( ! contact ) {
				state.touching = false;
				state.seconds = 0;
				continue;
			}
			const firstContact = ! state.touching;
			state.touching = true;
			state.seconds += Math.max( 0, delta );
			const [ heelL, heelR, toeL, toeR ] = contact.corners;
			const center = heelL.clone().add( heelR ).add( toeL ).add( toeR ).multiplyScalar( 0.25 );
			const width = heelL.clone().sub( heelR ).add( toeL ).sub( toeR )
				.multiplyScalar( 0.25 * options.footSizeScale );
			const length = toeL.clone().add( toeR ).sub( heelL ).sub( heelR )
				.multiplyScalar( 0.25 * options.footSizeScale );
			if ( Math.abs( width.x * length.z - width.z * length.x ) < 1e-8 ) continue;
			const angle = Math.atan2( length.x, length.z );
			// 接触时间模拟压实渐入；双脚支撑时分担载荷，不把 IK 修正权重当成压力。
			const press = 1 - Math.exp( - state.seconds / Math.max( options.footPressSeconds, 1e-3 ) );
			const strength = THREE.MathUtils.clamp(
				options.stampStrength * ( 0.55 + 0.45 * press ) * ( contactCount > 1 ? 0.75 : 1 ), 0, 1
			);
			const distance = Math.hypot( center.x - state.position.x, center.z - state.position.y );
			const turn = Math.abs( Math.atan2( Math.sin( angle - state.angle ), Math.cos( angle - state.angle ) ) );
			const pressureChanged = Math.abs( strength - state.strength ) >= 0.025
				|| contact.weights.some( ( weight, index ) => Math.abs( weight - state.weights[ index ] ) >= 0.1 );
			if ( ! firstContact && distance < options.footStampSpacing && turn < Math.PI / 36 && ! pressureChanged ) continue;
			map.queueStamp( {
				kind: 'footprint', x: center.x, z: center.z,
				halfWidth: [ width.x, width.z ], halfLength: [ length.x, length.z ],
				weights: contact.weights, strength
			} );
			state.position.set( center.x, center.z );
			state.angle = angle;
			state.strength = strength;
			state.weights = contact.weights;
		}
	}

	/** 释放接触采样器并清空双脚压力状态。 */
	dispose() {
		this.player.unuse( this.ik );
		this.ik.dispose();
		this.reset();
	}
}
