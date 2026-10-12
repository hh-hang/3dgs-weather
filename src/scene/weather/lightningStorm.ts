// 调度云内雷电的形状、分组和闪烁时序，并触发对应雷声。

import * as THREE from 'three';
import type { ThunderSky } from './ThunderSky';

/**
 * 云内随机放电。
 * 可见闪电一组 1～3 道：约 70% 分开、20% 可靠近、10% 允许交汇。
 * 小云洞由着色器保持连续；大片晴空的候选路径会丢掉并重新生成。
 * 不改场景环境光、太阳和曝光。
 */

const SLOT_COUNT = 3;
/** 两组雷暴之间的等待，单位秒。 */
const FLASH_INTERVAL_MIN = 3.0;
const FLASH_INTERVAL_MAX = 7.0;

type BoltEvent = {
	startTime: number;
	duration: number;
	cloudPeak: number;
	boltPeak: number;
	hasVisibleBolt: boolean;
	hasSecondPulse: boolean;
	secondPulseDelay: number;
	secondPulseScale: number;
};

type InteractionMode = 'cross' | 'near' | 'separate';

type BoltBasis = {
	right: THREE.Vector3;
	up: THREE.Vector3;
};

type BoltCandidate = {
	direction: THREE.Vector3;
	angle: number;
	length: number;
	width: number;
	bend: number;
	jaggedness: number;
	branchStrength: number;
	branchStart: number;
	branchSlope: number;
	cloudRadius: number;
	cloudStretch: number;
	seed: number;
	screenX: number;
	screenY: number;
	basis: BoltBasis;
};

type Segment2D = {
	a: { x: number; y: number };
	b: { x: number; y: number };
};

/** 调度云内闪电分组，限制路径位于云层，并为每组触发一次雷声。 */
export class LightningStorm {

	private enabled = false;
	private timer = 0;
	private nextFlash = THREE.MathUtils.randFloat( FLASH_INTERVAL_MIN, FLASH_INTERVAL_MAX );
	private groupActive = false;
	private groupTime = 0;
	private groupEndTime = 0;
	private readonly boltEvents: Array<BoltEvent | null> = [ null, null, null ];
	private readonly cameraDirection = new THREE.Vector3();
	private readonly right = new THREE.Vector3();
	private readonly up = new THREE.Vector3();

	constructor(
		private readonly sky: ThunderSky,
		private readonly onLightning?: () => void
	) {}

	/** 切换雷电调度，关闭时清空当前雷电槽位。 */
	setEnabled( enabled: boolean ) {

		this.enabled = enabled;

		if ( ! enabled ) {

			this.timer = 0;
			this.groupActive = false;
			this.clearSlots();

		} else {

			this.nextFlash = THREE.MathUtils.randFloat( FLASH_INTERVAL_MIN, FLASH_INTERVAL_MAX );

		}

	}

	/** 按帧间隔秒数推进雷电分组时序，并参考相机方向生成候选路径。 */
	update( camera: THREE.Camera, delta: number ) {

		if ( ! this.enabled ) {

			return;

		}

		this.timer += delta;

		if ( ! this.groupActive && this.timer >= this.nextFlash ) {

			this.timer = 0;
			this.trigger( camera );
			this.nextFlash = THREE.MathUtils.randFloat( FLASH_INTERVAL_MIN, FLASH_INTERVAL_MAX );

		}

		this.updateGroup( delta );

	}

	private trigger( camera: THREE.Camera ) {

		camera.getWorldDirection( this.cameraDirection );
		// 同一个雷电组事件同时驱动画面和雷声；组内多次闪烁不重复触发音频。
		this.onLightning?.();
		this.groupActive = true;
		this.groupTime = 0;
		this.groupEndTime = 0;

		const cloudOnly = Math.random() < 0.42;
		const visibleCount = cloudOnly ? 0 : THREE.MathUtils.randInt( 1, 3 );

		for ( let i = 0; i < SLOT_COUNT; i ++ ) {

			this.setSlot( i, 'lightningStrength', 0 );
			this.setSlot( i, 'cloudFlashStrength', 0 );
			this.boltEvents[ i ] = null;

		}

		if ( cloudOnly ) {

			this.randomizeBoltShape( camera, 0, [] );
			const duration = THREE.MathUtils.randFloat( 0.20, 0.58 );
			const startTime = THREE.MathUtils.randFloat( 0.0, 0.12 );
			this.boltEvents[ 0 ] = {
				startTime,
				duration,
				cloudPeak: THREE.MathUtils.randFloat( 0.45, 1.80 ),
				boltPeak: 0,
				hasVisibleBolt: false,
				hasSecondPulse: Math.random() < 0.68,
				secondPulseDelay: THREE.MathUtils.randFloat( 0.055, 0.20 ),
				secondPulseScale: THREE.MathUtils.randFloat( 0.22, 0.82 )
			};
			this.groupEndTime = startTime + duration + 0.25;
			return;

		}

		const acceptedBolts: BoltCandidate[] = [];
		let previousStart = THREE.MathUtils.randFloat( 0.0, 0.12 );

		for ( let i = 0; i < visibleCount; i ++ ) {

			const accepted = this.randomizeBoltShape( camera, i, acceptedBolts );

			if ( accepted ) {

				acceptedBolts.push( accepted );

			}

			let startTime = previousStart;

			if ( i > 0 ) {

				startTime = previousStart + THREE.MathUtils.randFloat( 0.015, 0.22 );
				previousStart = startTime;

			}

			const duration = THREE.MathUtils.randFloat( 0.25, 0.70 );
			this.boltEvents[ i ] = {
				startTime,
				duration,
				cloudPeak: THREE.MathUtils.randFloat( 0.45, 1.85 ),
				boltPeak: THREE.MathUtils.randFloat( 0.65, 2.00 ),
				hasVisibleBolt: true,
				hasSecondPulse: Math.random() < 0.72,
				secondPulseDelay: THREE.MathUtils.randFloat( 0.055, 0.21 ),
				secondPulseScale: THREE.MathUtils.randFloat( 0.20, 0.90 )
			};
			this.groupEndTime = Math.max( this.groupEndTime, startTime + duration + 0.28 );

		}

	}

	private updateGroup( delta: number ) {

		if ( ! this.groupActive ) {

			return;

		}

		this.groupTime += delta;

		for ( let i = 0; i < SLOT_COUNT; i ++ ) {

			const event = this.boltEvents[ i ];

			if ( ! event ) {

				continue;

			}

			const localTime = this.groupTime - event.startTime;
			let cloudPulse = pulseCurve( localTime, event.duration );
			let boltPulse = cloudPulse;

			if ( event.hasSecondPulse ) {

				cloudPulse += pulseCurve( localTime - event.secondPulseDelay, event.duration * 0.52 ) * event.secondPulseScale;
				boltPulse += pulseCurve( localTime - event.secondPulseDelay, event.duration * 0.40 ) * event.secondPulseScale;

			}

			cloudPulse = Math.min( cloudPulse, 1.8 );
			boltPulse = Math.min( boltPulse, 1.8 );

			this.setSlot( i, 'cloudFlashStrength', cloudPulse * event.cloudPeak );
			this.setSlot(
				i,
				'lightningStrength',
				event.hasVisibleBolt ? boltPulse * event.boltPeak : 0
			);

		}

		if ( this.groupTime > this.groupEndTime ) {

			this.groupActive = false;
			this.clearSlots();

		}

	}

	private randomizeBoltShape(
		camera: THREE.Camera,
		index: number,
		acceptedBolts: BoltCandidate[]
	) {

		this.right.set( 1, 0, 0 ).applyQuaternion( camera.quaternion );
		this.up.set( 0, 1, 0 ).applyQuaternion( camera.quaternion );

		const relationRoll = Math.random();
		const interactionMode: InteractionMode = relationRoll < 0.10
			? 'cross'
			: relationRoll < 0.30
				? 'near'
				: 'separate';

		let bestCandidate: BoltCandidate | null = null;
		let bestScore = - Infinity;

		const view = camera as THREE.PerspectiveCamera;
		const halfTanY = Math.tan( THREE.MathUtils.degToRad( view.fov ) * 0.5 );
		const halfTanX = halfTanY * view.aspect;

		for ( let attempt = 0; attempt < 30; attempt ++ ) {

			const offsetX = THREE.MathUtils.randFloat( - halfTanX, halfTanX );
			const offsetY = THREE.MathUtils.randFloat( - halfTanY, halfTanY );
			const direction = this.cameraDirection.clone()
				.addScaledVector( this.right, offsetX )
				.addScaledVector( this.up, offsetY )
				.normalize();

			const candidate: BoltCandidate = {
				direction,
				angle: THREE.MathUtils.degToRad( THREE.MathUtils.randFloat( - 82, 82 ) ),
				length: THREE.MathUtils.randFloat( 0.13, 0.58 ),
				width: THREE.MathUtils.randFloat( 0.0009, 0.0025 ),
				bend: THREE.MathUtils.randFloat( - 0.42, 0.42 ),
				jaggedness: THREE.MathUtils.randFloat( 0.50, 1.75 ),
				branchStrength: THREE.MathUtils.randFloat( 0, 1 ),
				branchStart: THREE.MathUtils.randFloat( - 0.13, 0.13 ),
				branchSlope: THREE.MathUtils.randFloat( - 0.95, 0.95 ),
				cloudRadius: THREE.MathUtils.randFloat( 0.045, 0.20 ),
				cloudStretch: THREE.MathUtils.randFloat( 0.65, 3.3 ),
				seed: Math.random() * 1000,
				screenX: offsetX,
				screenY: offsetY,
				basis: lightningBasis( direction )
			};
			const continuity = evaluateCloudContinuity( candidate, this.sky );
			const conflict = candidateConflicts( candidate, acceptedBolts, interactionMode );
			const score = continuity.average - continuity.maxClearRun * 0.18 - ( conflict ? 0.35 : 0 );

			if ( score > bestScore ) {

				bestScore = score;
				bestCandidate = candidate;

			}

			if ( continuity.valid && ! conflict ) {

				bestCandidate = candidate;
				break;

			}

		}

		if ( bestCandidate === null ) {

			return null;

		}

		if ( ! evaluateCloudContinuity( bestCandidate, this.sky ).valid ) {

			bestCandidate.length *= 0.62;

		}

		( this.uniform( index, 'lightningDirection' ).value as THREE.Vector3 ).copy( bestCandidate.direction );
		this.setSlot( index, 'lightningSeed', bestCandidate.seed );
		this.setSlot( index, 'lightningAngle', bestCandidate.angle );
		this.setSlot( index, 'lightningLength', bestCandidate.length );
		this.setSlot( index, 'lightningWidth', bestCandidate.width );
		this.setSlot( index, 'lightningBend', bestCandidate.bend );
		this.setSlot( index, 'lightningJaggedness', bestCandidate.jaggedness );
		this.setSlot( index, 'lightningBranchStrength', bestCandidate.branchStrength );
		this.setSlot( index, 'lightningBranchStart', bestCandidate.branchStart );
		this.setSlot( index, 'lightningBranchSlope', bestCandidate.branchSlope );
		this.setSlot( index, 'lightningCloudRadius', bestCandidate.cloudRadius );
		this.setSlot( index, 'lightningCloudStretch', bestCandidate.cloudStretch );
		( this.uniform( index, 'lightningColor' ).value as THREE.Color ).setHSL(
			THREE.MathUtils.randFloat( 0.66, 0.77 ),
			THREE.MathUtils.randFloat( 0.28, 0.65 ),
			THREE.MathUtils.randFloat( 0.72, 0.92 ),
			THREE.SRGBColorSpace
		);

		return bestCandidate;

	}

	private clearSlots() {

		for ( let i = 0; i < SLOT_COUNT; i ++ ) {

			this.setSlot( i, 'lightningStrength', 0 );
			this.setSlot( i, 'cloudFlashStrength', 0 );
			this.boltEvents[ i ] = null;

		}

	}

	private uniform( index: number, name: string ) {

		return this.sky.material.uniforms[ `${ name }${ index }` ];

	}

	private setSlot( index: number, name: string, value: number ) {

		this.uniform( index, name ).value = value;

	}

}

function pulseCurve( t: number, duration: number ) {

	if ( t < 0 || t > duration ) {

		return 0;

	}

	const attack = Math.max( 0.012, duration * 0.10 );

	if ( t < attack ) {

		return t / attack;

	}

	return Math.max( 0, 1 - ( t - attack ) / Math.max( 0.001, duration - attack ) );

}

function fract( v: number ) {

	return v - Math.floor( v );

}

function smoothstepJS( edge0: number, edge1: number, x: number ) {

	const t = THREE.MathUtils.clamp( ( x - edge0 ) / ( edge1 - edge0 ), 0, 1 );
	return t * t * ( 3 - 2 * t );

}

function cloudGradient( x: number, y: number ) {

	let px = fract( x * 0.1031 );
	let py = fract( y * 0.1030 );
	let pz = fract( x * 0.0973 );
	const dotValue = px * ( py + 33.33 ) + py * ( pz + 33.33 ) + pz * ( px + 33.33 );
	px += dotValue;
	py += dotValue;
	pz += dotValue;

	return [
		fract( ( px + py ) * pz ) * 2 - 1,
		fract( ( px + pz ) * py ) * 2 - 1
	];

}

function cloudNoise2D( x: number, y: number ) {

	const ix = Math.floor( x );
	const iy = Math.floor( y );
	const fx = x - ix;
	const fy = y - iy;
	const ux = fx * fx * fx * ( fx * ( fx * 6 - 15 ) + 10 );
	const uy = fy * fy * fy * ( fy * ( fy * 6 - 15 ) + 10 );
	const g00 = cloudGradient( ix, iy );
	const g10 = cloudGradient( ix + 1, iy );
	const g01 = cloudGradient( ix, iy + 1 );
	const g11 = cloudGradient( ix + 1, iy + 1 );
	const a = g00[ 0 ] * fx + g00[ 1 ] * fy;
	const b = g10[ 0 ] * ( fx - 1 ) + g10[ 1 ] * fy;
	const c = g01[ 0 ] * fx + g01[ 1 ] * ( fy - 1 );
	const d = g11[ 0 ] * ( fx - 1 ) + g11[ 1 ] * ( fy - 1 );
	const ab = THREE.MathUtils.lerp( a, b, ux );
	const cd = THREE.MathUtils.lerp( c, d, ux );

	return THREE.MathUtils.lerp( ab, cd, uy ) * 1.6;

}

function cloudFBM( x: number, y: number, drift: number ) {

	let result = 0;
	let amplitude = 1;

	for ( let i = 0; i < 4; i ++ ) {

		result += amplitude * cloudNoise2D( x, y );
		amplitude *= 0.5;
		x = x * 2 + drift;
		y = y * 2 + drift;

	}

	return result;

}

function skyNumber( sky: ThunderSky, name: string ) {

	return sky.material.uniforms[ name ].value as number;

}

function cloudPresenceForDirection( direction: THREE.Vector3, sky: ThunderSky ) {

	if ( direction.y <= 0 ) {

		return 0;

	}

	const elevation = THREE.MathUtils.lerp( 1.0, 0.1, skyNumber( sky, 'cloudElevation' ) );
	const denom = direction.y * elevation;
	let uvX = direction.x / denom * skyNumber( sky, 'cloudScale' );
	let uvY = direction.z / denom * skyNumber( sky, 'cloudScale' );
	const time = skyNumber( sky, 'time' );
	const speed = skyNumber( sky, 'cloudSpeed' );
	uvX += time * speed;
	uvY += time * speed;
	const evolve = time * speed * 300.0;
	const cloudNoise = THREE.MathUtils.clamp(
		cloudFBM( uvX * 1000, uvY * 1000, evolve ) * 0.7 + 0.5,
		0,
		1
	);
	const region = cloudNoise2D( uvX * 300, uvY * 300 ) * 0.37 + 0.5;
	const cov = THREE.MathUtils.clamp(
		skyNumber( sky, 'cloudCoverage' ) + ( region - 0.5 ) * 0.6,
		0,
		1
	);
	const threshold = 1 - cov;
	const cloudMask = smoothstepJS( threshold, threshold + 0.3, cloudNoise );
	const horizonFade = smoothstepJS( 0, 0.03 + 0.06 * skyNumber( sky, 'cloudElevation' ), direction.y );

	return cloudMask * horizonFade;

}

function lightningBasis( centerDirection: THREE.Vector3 ): BoltBasis {

	const right = new THREE.Vector3().crossVectors( new THREE.Vector3( 0, 1, 0 ), centerDirection );

	if ( right.lengthSq() < 1e-6 ) {

		right.set( 1, 0, 0 );

	} else {

		right.normalize();

	}

	const up = new THREE.Vector3().crossVectors( centerDirection, right ).normalize();

	return { right, up };

}

function candidateDirectionAt( candidate: BoltCandidate, normalizedT: number ) {

	const halfLength = candidate.length * 0.5;
	const x = THREE.MathUtils.lerp( - halfLength, halfLength, normalizedT );
	const y = candidate.bend * ( x * x - x * 0.08 );
	const c = Math.cos( candidate.angle );
	const s = Math.sin( candidate.angle );
	const x0 = x * c - y * s;
	const y0 = x * s + y * c;

	return candidate.direction.clone()
		.addScaledVector( candidate.basis.right, x0 )
		.addScaledVector( candidate.basis.up, y0 )
		.normalize();

}

function evaluateCloudContinuity( candidate: BoltCandidate, sky: ThunderSky ) {

	const sampleCount = 13;
	let total = 0;
	let clearRun = 0;
	let maxClearRun = 0;
	let cloudSamples = 0;

	for ( let i = 0; i < sampleCount; i ++ ) {

		const presence = cloudPresenceForDirection(
			candidateDirectionAt( candidate, i / ( sampleCount - 1 ) ),
			sky
		);
		total += presence;

		if ( presence > 0.10 ) {

			cloudSamples ++;
			clearRun = 0;

		} else {

			clearRun ++;
			maxClearRun = Math.max( maxClearRun, clearRun );

		}

	}

	const average = total / sampleCount;

	return {
		valid: maxClearRun <= 1 && cloudSamples >= 10 && average >= 0.19,
		average,
		maxClearRun,
		cloudSamples
	};

}

function boltSegment2D( candidate: BoltCandidate ): Segment2D {

	const half = candidate.length * 0.5;
	const dx = Math.cos( candidate.angle ) * half;
	const dy = Math.sin( candidate.angle ) * half;

	return {
		a: { x: candidate.screenX - dx, y: candidate.screenY - dy },
		b: { x: candidate.screenX + dx, y: candidate.screenY + dy }
	};

}

function orient2D(
	a: { x: number; y: number },
	b: { x: number; y: number },
	c: { x: number; y: number }
) {

	return ( b.x - a.x ) * ( c.y - a.y ) - ( b.y - a.y ) * ( c.x - a.x );

}

function segmentsCross( s1: Segment2D, s2: Segment2D ) {

	const o1 = orient2D( s1.a, s1.b, s2.a );
	const o2 = orient2D( s1.a, s1.b, s2.b );
	const o3 = orient2D( s2.a, s2.b, s1.a );
	const o4 = orient2D( s2.a, s2.b, s1.b );

	return o1 * o2 < 0 && o3 * o4 < 0;

}

function candidateConflicts(
	candidate: BoltCandidate,
	acceptedBolts: BoltCandidate[],
	interactionMode: InteractionMode
) {

	if ( acceptedBolts.length === 0 ) {

		return false;

	}

	const segment = boltSegment2D( candidate );

	for ( const previous of acceptedBolts ) {

		const crossing = segmentsCross( segment, boltSegment2D( previous ) );
		const centerDistance = Math.hypot(
			candidate.screenX - previous.screenX,
			candidate.screenY - previous.screenY
		);

		if ( interactionMode !== 'cross' && crossing ) {

			return true;

		}

		if ( interactionMode === 'separate' && centerDistance < 0.13 ) {

			return true;

		}

	}

	return false;

}
