// 在高斯点着色阶段合成环境光、太阳光、车灯和矩形照射灯。

import { dyno, type SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { LIGHT_SHADOW_SLOTS, type LightShadowSlot } from '../collider/colliderLightShadows';
import { FLOOD_LIGHT_LIMIT, type SceneFloodLight } from './sceneFloodLights';
import { SCENE_EFFECT_CONFIG } from '../sceneEffectConfig';

/** 高斯点的环境光与太阳光参数。 */
export type SplatLightingOptions = {
	/** 环境光设置。 */
	ambient: {
		/** 是否启用环境光调制。 */
		enabled: boolean;
		/** 环境光强度，非负值。 */
		intensity: number;
		/** 环境光颜色。 */
		color: THREE.Color;
	};
	/** 太阳方向光设置。 */
	sun: {
		/** 是否启用太阳光。 */
		enabled: boolean;
		/** 指向太阳位置的世界空间方向。 */
		direction: THREE.Vector3;
		/** 太阳光强度，非负值。 */
		intensity: number;
		/** 太阳光颜色。 */
		color: THREE.Color;
	};
};

/** 用于高斯点着色的世界空间近光光束参数。 */
export type SplatHeadlightBeam = {
	/** 灯口中心的世界坐标。 */
	worldPosition: THREE.Vector3;
	/** 光束在世界空间中的朝向。 */
	worldDirection: THREE.Vector3;
	/** 近光颜色。 */
	color: THREE.Color;
	/** 聚光灯强度，非负值。 */
	intensity: number;
	/** 光束半张角，单位为弧度。 */
	angle: number;
	/** 锥形边缘柔化比例，范围为 0–1。 */
	penumbra: number;
	/** 最大照射距离，世界单位。 */
	distance: number;
};

/** 将聚光灯强度换算为高斯点亮度；强度 360 对应锥心约 0.8 倍原色的叠加量。 */
const SPLAT_HEADLIGHT_GAIN = 0.8 / 360;
const _headInv = new THREE.Matrix4();
const _headPos = new THREE.Vector3();
const _headDir = new THREE.Vector3();
const _headScale = new THREE.Vector3();

/** 高斯点光照的挂载、参数同步与资源释放接口。 */
export type SplatLightingHandle = {
	/** 是否已挂载到高斯点网格。 */
	attached: boolean;
	/** 当前环境光与太阳光参数对象。 */
	options: SplatLightingOptions;
	/** 开场展开完成后挂载光照修改器。 */
	attach: ( mesh: SplatMesh ) => void;
	/** 按归一化时刻同步太阳方向、颜色和强度，范围为 0–1。 */
	setTimeOfDay: ( timeOfDay: number ) => void;
	/** 切换环境光调制。 */
	setAmbientEnabled: ( enabled: boolean ) => void;
	/** 设置非负的环境光强度。 */
	setAmbientIntensity: ( intensity: number ) => void;
	/** 切换太阳光调制。 */
	setSunEnabled: ( enabled: boolean ) => void;
	/** 写入近光光束；null 表示关闭，网格用于世界坐标到局部坐标的换算。 */
	setHeadlights: ( beams: SplatHeadlightBeam[] | null, splatMesh?: SplatMesh ) => void;
	/** 写入矩形照射灯；最多处理四盏，白天将照射强度设为 0。 */
	setFloodLights: ( lights: SceneFloodLight[], splatMesh: SplatMesh | undefined, night: boolean ) => void;
	/** 绑定碰撞深度图；前两个槽位为车灯，后续槽位为照射灯，null 关闭遮挡。 */
	setOcclusion: ( slots: LightShadowSlot[] | null ) => void;
	/** 返回当前世界空间太阳方向。 */
	getSunDirection: () => THREE.Vector3;
	/** 卸载当前光照修改器并清理网格引用。 */
	dispose: () => void;
};

const DEFAULT_AMBIENT_COLOR = new THREE.Color( 1, 1, 1 );
const DEFAULT_SUN_COLOR = new THREE.Color( 1, 1, 1 );
const DEFAULT_SUN_DIR = new THREE.Vector3( 0.5, -1, 0.3 ).normalize();

/**
 * 由归一化时刻推导太阳仰角、方位与方向。
 * 0=午夜，0.25=6:00 日出，0.5=12:00 正午，0.75=18:00 日落。
 * 日照时段为 6:00–18:00，其余在地平线下。
 *
 * @param timeOfDay - 0–1。
 */
export const sunDirectionFromTimeOfDay = ( timeOfDay: number ): {
	/** 指向太阳位置的世界空间单位向量。 */
	direction: THREE.Vector3;
	/** 太阳仰角，单位为度。 */
	elevationDeg: number;
	/** 太阳方位角，单位为度。 */
	azimuthDeg: number;
	/** 太阳是否位于地平线上方。 */
	aboveHorizon: boolean;
} => {

	const t = THREE.MathUtils.clamp( timeOfDay, 0, 1 );
	const sunrise = 0.25;
	const sunset = 0.75;
	const maxElevation = 70;
	let elevationDeg: number;

	if ( t > sunrise && t < sunset ) {

		// 日出至日落的仰角按正弦曲线变化，正午最高。
		const dayT = ( t - sunrise ) / ( sunset - sunrise );
		elevationDeg = Math.sin( dayT * Math.PI ) * maxElevation;

	} else if ( t <= sunrise ) {

		// 午夜至日出，太阳逐渐升至地平线。
		elevationDeg = THREE.MathUtils.lerp( - 20, 0, t / sunrise );

	} else {

		// 日落至午夜，太阳逐渐降至地平线下。
		elevationDeg = THREE.MathUtils.lerp( 0, - 20, ( t - sunset ) / ( 1 - sunset ) );

	}

	const azimuthDeg = t * 360 - 90;
	const direction = new THREE.Vector3().setFromSphericalCoords(
		1,
		THREE.MathUtils.degToRad( 90 - elevationDeg ),
		THREE.MathUtils.degToRad( azimuthDeg )
	);
	return {
		direction,
		elevationDeg,
		azimuthDeg,
		aboveHorizon: elevationDeg > 0
	};

};

/**
 * 按归一化时刻四舍五入到整点，6 点及以前、18 点及以后判定为夜晚。
 *
 * @param timeOfDay - 0–1，0 为午夜。
 */
export const isNightTimeOfDay = ( timeOfDay: number ) => {

	const hour = Math.min( 24, Math.round( THREE.MathUtils.clamp( timeOfDay, 0, 1 ) * 24 ) );
	return hour <= 6 || hour >= 18;

};

/**
 * 按仰角计算太阳颜色：日出和日落偏暖，正午白色，地平线下为弱蓝色。
 *
 * @param elevationDeg - 太阳仰角，单位为度。
 * @param out - 写入目标颜色。
 */
export const sunColorFromElevation = ( elevationDeg: number, out: THREE.Color ): THREE.Color => {

	if ( elevationDeg <= 0 ) {

		return out.setRGB( 0.35, 0.4, 0.65 );

	}

	const warm = new THREE.Color( 0xff9a5c );
	const white = new THREE.Color( 1, 1, 1 );
	// 低仰角使用暖色，升高后过渡到白色，约 45 度以上接近纯白。
	const blend = THREE.MathUtils.clamp( elevationDeg / 45, 0, 1 );
	return out.copy( warm ).lerp( white, blend );

};

/**
 * 按仰角计算太阳强度：地平线下为 0，正午约为 1.15。
 *
 * @param elevationDeg - 太阳仰角，单位为度。
 */
export const sunIntensityFromElevation = ( elevationDeg: number ): number => {

	if ( elevationDeg <= 0 ) {

		return 0;

	}

	return THREE.MathUtils.clamp( elevationDeg / 70, 0, 1 ) * 1.15;

};

/**
 * 创建高斯点光照管理器，合成环境光、太阳光、车灯和矩形照射灯。
 * 在开场展开完成后调用 attach，避免两个效果同时占用高斯点修改器。
 *
 * 各路光照统一在 Dyno 中计算，避免分阶段处理时环境光重复衰减。
 */
export const createSplatLighting = (): SplatLightingHandle => {

	const options: SplatLightingOptions = {
		ambient: {
			enabled: false,
			intensity: 0.5,
			color: DEFAULT_AMBIENT_COLOR.clone()
		},
		sun: {
			enabled: false,
			direction: DEFAULT_SUN_DIR.clone(),
			intensity: 1,
			color: DEFAULT_SUN_COLOR.clone()
		}
	};

	const ambientEnabled = dyno.dynoFloat( 0 );
	const ambientIntensity = dyno.dynoFloat( 1 );
	const ambientColor = dyno.dynoVec3( new THREE.Vector3( 1, 1, 1 ) );
	const sunEnabled = dyno.dynoFloat( 0 );
	const sunIntensity = dyno.dynoFloat( 1 );
	const sunDir = dyno.dynoVec3( new THREE.Vector3( 0.5, -1, 0.3 ) );
	const sunColor = dyno.dynoVec3( new THREE.Vector3( 1, 1, 1 ) );
	const centerX = dyno.dynoFloat( SCENE_EFFECT_CONFIG.splatLighting.center[ 0 ] );
	const centerY = dyno.dynoFloat( SCENE_EFFECT_CONFIG.splatLighting.center[ 1 ] );
	const centerZ = dyno.dynoFloat( SCENE_EFFECT_CONFIG.splatLighting.center[ 2 ] );
	const extent = dyno.dynoFloat( SCENE_EFFECT_CONFIG.splatLighting.extent );
	const hlOn = dyno.dynoFloat( 0 );
	const occOn = dyno.dynoFloat( 1 );
	const hl0Pos = dyno.dynoVec3( new THREE.Vector3() );
	const hl0Dir = dyno.dynoVec3( new THREE.Vector3( 0, 0, - 1 ) );
	const hl0Color = dyno.dynoVec3( new THREE.Vector3( 1, 0.93, 0.75 ) );
	const hl0Intensity = dyno.dynoFloat( 0 );
	const hl0CosOuter = dyno.dynoFloat( 0.95 );
	const hl0CosInner = dyno.dynoFloat( 0.99 );
	const hl0Dist = dyno.dynoFloat( 1 );
	const hl1Pos = dyno.dynoVec3( new THREE.Vector3() );
	const hl1Dir = dyno.dynoVec3( new THREE.Vector3( 0, 0, - 1 ) );
	const hl1Color = dyno.dynoVec3( new THREE.Vector3( 1, 0.93, 0.75 ) );
	const hl1Intensity = dyno.dynoFloat( 0 );
	const hl1CosOuter = dyno.dynoFloat( 0.95 );
	const hl1CosInner = dyno.dynoFloat( 0.99 );
	const hl1Dist = dyno.dynoFloat( 1 );
	const floodSlots = Array.from( { length: FLOOD_LIGHT_LIMIT }, () => ( {
		pos: dyno.dynoVec3( new THREE.Vector3() ),
		dir: dyno.dynoVec3( new THREE.Vector3( 0, - 1, 0 ) ),
		color: dyno.dynoVec3( new THREE.Vector3( 1, 0.95, 0.82 ) ),
		size: dyno.dynoVec4( new THREE.Vector4( 4, 2, 16, 0 ) ),
		spread: dyno.dynoFloat( 0.18 ),
		soft: dyno.dynoFloat( 0.28 )
	} ) );
	const floodInTypes = Object.fromEntries( floodSlots.flatMap( ( _, index ) => [
		[ `fl${ index }Pos`, 'vec3' ],
		[ `fl${ index }Dir`, 'vec3' ],
		[ `fl${ index }Color`, 'vec3' ],
		[ `fl${ index }Size`, 'vec4' ],
		[ `fl${ index }Spread`, 'float' ],
		[ `fl${ index }Soft`, 'float' ]
	] ) );
	const shadowSlots = Array.from( { length: LIGHT_SHADOW_SLOTS }, () => ( {
		matrix: dyno.dynoMat4( new THREE.Matrix4() ),
		map: dyno.dynoSampler2D( new THREE.DataTexture( new Float32Array( [ 1, 1, 1, 1 ] ), 1, 1 ) )
	} ) );
	const shadowInTypes = Object.fromEntries( shadowSlots.flatMap( ( _, index ) => [
		[ `sh${ index }Mat`, 'mat4' ],
		[ `sh${ index }Map`, 'sampler2D' ]
	] ) );
	const shadowApply = Object.fromEntries( shadowSlots.flatMap( ( slot, index ) => [
		[ `sh${ index }Mat`, slot.matrix ],
		[ `sh${ index }Map`, slot.map ]
	] ) );
	const floodApply = Object.fromEntries( floodSlots.flatMap( ( slot, index ) => [
		[ `fl${ index }Pos`, slot.pos ],
		[ `fl${ index }Dir`, slot.dir ],
		[ `fl${ index }Color`, slot.color ],
		[ `fl${ index }Size`, slot.size ],
		[ `fl${ index }Spread`, slot.spread ],
		[ `fl${ index }Soft`, slot.soft ]
	] ) );

	const lightingModifier = dyno.dynoBlock(
		{ gsplat: dyno.Gsplat },
		{ gsplat: dyno.Gsplat },
		( { gsplat } ) => {

			const node = new dyno.Dyno( {
				inTypes: {
					gsplat: dyno.Gsplat,
					ambOn: 'float',
					ambIntensity: 'float',
					ambColor: 'vec3',
					sunOn: 'float',
					sunIntensity: 'float',
					sunDir: 'vec3',
					sunColor: 'vec3',
					cx: 'float',
					cy: 'float',
					cz: 'float',
					ext: 'float',
					hlOn: 'float',
					occOn: 'float',
					hl0Pos: 'vec3',
					hl0Dir: 'vec3',
					hl0Color: 'vec3',
					hl0Intensity: 'float',
					hl0CosOuter: 'float',
					hl0CosInner: 'float',
					hl0Dist: 'float',
					hl1Pos: 'vec3',
					hl1Dir: 'vec3',
					hl1Color: 'vec3',
					hl1Intensity: 'float',
					hl1CosOuter: 'float',
					hl1CosInner: 'float',
					hl1Dist: 'float',
					...floodInTypes,
					...shadowInTypes
				},
				outTypes: { gsplat: dyno.Gsplat },
				statements: ( { inputs, outputs } ) => {

					const floodCalls = floodSlots.map( ( _, index ) => {

						const name = `fl${ index }`;
						const typed = inputs as Record<string, string>;
						const pos = typed[ `${ name }Pos` ];
						const dir = typed[ `${ name }Dir` ];
						const color = typed[ `${ name }Color` ];
						const size = typed[ `${ name }Size` ];
						const spread = typed[ `${ name }Spread` ];
						const soft = typed[ `${ name }Soft` ];
						const shadowIndex = index + 2;
						const shadowMat = typed[ `sh${ shadowIndex }Mat` ];
						const shadowMap = typed[ `sh${ shadowIndex }Map` ];
						return `
						{
							vec3 flDir = ${ dir };
							vec3 flAxis = abs( flDir.y ) > 0.92 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 0.0, 1.0, 0.0 );
							vec3 flRight = normalize( cross( flAxis, flDir ) );
							vec3 flUp = cross( flDir, flRight );
							vec3 flTo = gpos - ${ pos };
							float flAlong = dot( flTo, flDir );
							float flReach = max( ${ size }.z, 0.001 );
							float flSoft = clamp( ${ soft }, 0.02, 0.9 );
							float flGate = smoothstep( 0.0, flReach * flSoft * 0.35, flAlong ) * ( 1.0 - smoothstep( flReach * ( 1.0 - flSoft * 0.45 ), flReach, flAlong ) );
							float flGrow = tan( max( ${ spread }, 0.0 ) ) * max( flAlong, 0.0 );
							float flHx = max( ${ size }.x * 0.5 + flGrow, 1e-4 );
							float flHy = max( ${ size }.y * 0.5 + flGrow, 1e-4 );
							float flMx = 1.0 - smoothstep( flHx * ( 1.0 - flSoft ), flHx, abs( dot( flTo, flRight ) ) );
							float flMy = 1.0 - smoothstep( flHy * ( 1.0 - flSoft ), flHy, abs( dot( flTo, flUp ) ) );
							float flAtt = pow( 1.0 - clamp( flAlong / flReach, 0.0, 1.0 ), 1.35 );
							vec4 flShadow = ${ shadowMat } * vec4( gpos, 1.0 );
							vec3 flUv = flShadow.xyz / max( flShadow.w, 1e-5 );
							float flOcc = 1.0;
							if ( ${ typed.occOn } > 0.5 && flUv.x >= 0.0 && flUv.x <= 1.0 && flUv.y >= 0.0 && flUv.y <= 1.0 && flUv.z >= 0.0 && flUv.z <= 1.0 ) {
								flOcc = flUv.z <= texture( ${ shadowMap }, flUv.xy ).r + 0.004 ? 1.0 : 0.0;
							}
							headTerm += original * ${ color } * ${ size }.w * flMx * flMy * flGate * flAtt * flOcc;
						}`;

					} ).join( '\n' );

					return dyno.unindentLines( /* glsl */ `
					${ outputs.gsplat } = ${ inputs.gsplat };
					vec3 original = ${ inputs.gsplat }.rgba.rgb;

					// 环境光关闭时保留原色；开启时将原色乘以环境光颜色和强度。
					vec3 ambientTerm = original;
					if ( ${ inputs.ambOn } > 0.5 ) {
						ambientTerm = original * ${ inputs.ambColor } * ${ inputs.ambIntensity };
					}

					vec3 sunTerm = vec3( 0.0 );
					if ( ${ inputs.sunOn } > 0.5 ) {
						vec3 pos = ${ inputs.gsplat }.center;
						vec3 center = vec3( ${ inputs.cx }, ${ inputs.cy }, ${ inputs.cz } );
						vec3 offset = pos - center;
						float span = max( ${ inputs.ext }, 0.001 );
						vec3 local = offset / span;
						// 以高斯点相对中心的位置近似受光方向，形成方向性亮度变化。
						vec3 toLight = normalize( -${ inputs.sunDir } );
						float side = dot( normalize( local + vec3( 1e-4 ) ), toLight );
						float directional = 0.28 + 0.72 * clamp( side * 0.5 + 0.5, 0.0, 1.0 );
						float heightTerm = 0.82 + 0.18 * clamp( local.y * 0.5 + 0.5, 0.0, 1.0 );
						directional *= heightTerm;
						sunTerm = original * ${ inputs.sunColor } * ${ inputs.sunIntensity } * directional;
					}

					vec3 headTerm = vec3( 0.0 );
					vec3 gpos = ${ inputs.gsplat }.center;
					if ( ${ inputs.hlOn } > 0.5 ) {

						vec3 to0 = gpos - ${ inputs.hl0Pos };
						float d0 = length( to0 );
						float att0 = pow( 1.0 - clamp( d0 / max( ${ inputs.hl0Dist }, 0.001 ), 0.0, 1.0 ), 1.35 );
						float spot0 = smoothstep( ${ inputs.hl0CosOuter }, ${ inputs.hl0CosInner }, dot( to0 / max( d0, 1e-5 ), ${ inputs.hl0Dir } ) );
						vec4 sh0 = ${ ( inputs as Record<string, string> ).sh0Mat } * vec4( gpos, 1.0 );
						vec3 sh0Uv = sh0.xyz / max( sh0.w, 1e-5 );
						float occ0 = 1.0;
						if ( ${ inputs.occOn } > 0.5 && sh0Uv.x >= 0.0 && sh0Uv.x <= 1.0 && sh0Uv.y >= 0.0 && sh0Uv.y <= 1.0 && sh0Uv.z >= 0.0 && sh0Uv.z <= 1.0 ) {
							occ0 = sh0Uv.z <= texture( ${ ( inputs as Record<string, string> ).sh0Map }, sh0Uv.xy ).r + 0.004 ? 1.0 : 0.0;
						}
						headTerm += original * ${ inputs.hl0Color } * ${ inputs.hl0Intensity } * att0 * spot0 * occ0;

						vec3 to1 = gpos - ${ inputs.hl1Pos };
						float d1 = length( to1 );
						float att1 = pow( 1.0 - clamp( d1 / max( ${ inputs.hl1Dist }, 0.001 ), 0.0, 1.0 ), 1.35 );
						float spot1 = smoothstep( ${ inputs.hl1CosOuter }, ${ inputs.hl1CosInner }, dot( to1 / max( d1, 1e-5 ), ${ inputs.hl1Dir } ) );
						vec4 sh1 = ${ ( inputs as Record<string, string> ).sh1Mat } * vec4( gpos, 1.0 );
						vec3 sh1Uv = sh1.xyz / max( sh1.w, 1e-5 );
						float occ1 = 1.0;
						if ( ${ inputs.occOn } > 0.5 && sh1Uv.x >= 0.0 && sh1Uv.x <= 1.0 && sh1Uv.y >= 0.0 && sh1Uv.y <= 1.0 && sh1Uv.z >= 0.0 && sh1Uv.z <= 1.0 ) {
							occ1 = sh1Uv.z <= texture( ${ ( inputs as Record<string, string> ).sh1Map }, sh1Uv.xy ).r + 0.004 ? 1.0 : 0.0;
						}
						headTerm += original * ${ inputs.hl1Color } * ${ inputs.hl1Intensity } * att1 * spot1 * occ1;
					}
					${ floodCalls }

					// 各路光照独立累加，避免环境光对太阳光和车灯重复衰减。
					${ outputs.gsplat }.rgba.rgb = ambientTerm + sunTerm + headTerm;
				` );

				}
			} );

			gsplat = node.apply( {
				gsplat,
				ambOn: ambientEnabled,
				ambIntensity: ambientIntensity,
				ambColor: ambientColor,
				sunOn: sunEnabled,
				sunIntensity: sunIntensity,
				sunDir: sunDir,
				sunColor: sunColor,
				cx: centerX,
				cy: centerY,
				cz: centerZ,
				ext: extent,
				hlOn,
				occOn,
				hl0Pos,
				hl0Dir,
				hl0Color,
				hl0Intensity,
				hl0CosOuter,
				hl0CosInner,
				hl0Dist,
				hl1Pos,
				hl1Dir,
				hl1Color,
				hl1Intensity,
				hl1CosOuter,
				hl1CosInner,
				hl1Dist,
				...floodApply,
				...shadowApply
			} ).gsplat;
			return { gsplat };

		}
	);

	let mesh: SplatMesh | undefined;
	let attached = false;

	const refreshUniforms = () => {

		ambientEnabled.value = attached && options.ambient.enabled ? 1 : 0;
		ambientIntensity.value = Math.max( 0, options.ambient.intensity );
		ambientColor.value.set(
			options.ambient.color.r,
			options.ambient.color.g,
			options.ambient.color.b
		);
		sunEnabled.value = attached && options.sun.enabled ? 1 : 0;
		sunIntensity.value = Math.max( 0, options.sun.intensity );
		sunDir.value.copy( options.sun.direction );
		sunColor.value.set(
			options.sun.color.r,
			options.sun.color.g,
			options.sun.color.b
		);
		mesh?.updateVersion();

	};

	const installModifier = () => {

		if ( ! mesh ) {

			return;

		}

		mesh.objectModifier = lightingModifier;
		mesh.updateGenerator();
		mesh.updateVersion();

	};

	const writeHeadlightSlot = (
		beam: SplatHeadlightBeam | undefined,
		pos: typeof hl0Pos,
		dir: typeof hl0Dir,
		color: typeof hl0Color,
		intensity: typeof hl0Intensity,
		cosOuter: typeof hl0CosOuter,
		cosInner: typeof hl0CosInner,
		dist: typeof hl0Dist,
		worldScale: number
	) => {

		if ( ! beam ) {

			intensity.value = 0;
			return;

		}

		_headPos.copy( beam.worldPosition ).applyMatrix4( _headInv );
		_headDir.copy( beam.worldDirection ).transformDirection( _headInv );

		if ( _headDir.lengthSq() < 1e-8 ) {

			_headDir.set( 0, 0, - 1 );

		} else {

			_headDir.normalize();

		}

		pos.value.copy( _headPos );
		dir.value.copy( _headDir );
		color.value.set( beam.color.r, beam.color.g, beam.color.b );
		intensity.value = Math.max( 0, beam.intensity * SPLAT_HEADLIGHT_GAIN );
		const outer = Math.cos( Math.max( beam.angle, 1e-4 ) );
		const inner = Math.cos( Math.max( beam.angle * ( 1 - THREE.MathUtils.clamp( beam.penumbra, 0, 0.99 ) ), 1e-4 ) );
		cosOuter.value = outer;
		cosInner.value = Math.max( inner, outer + 1e-4 );
		dist.value = Math.max( beam.distance / worldScale, 1e-3 );

	};

	const handle: SplatLightingHandle = {
		get attached() {

			return attached;

		},
		options,
		attach( target: SplatMesh ) {

			mesh = target;
			attached = true;
			refreshUniforms();
			installModifier();

		},
		setTimeOfDay( timeOfDay: number ) {

			const { direction, elevationDeg } = sunDirectionFromTimeOfDay( timeOfDay );
			options.sun.direction.copy( direction );
			sunColorFromElevation( elevationDeg, options.sun.color );
			options.sun.intensity = sunIntensityFromElevation( elevationDeg );
			refreshUniforms();

		},
		setAmbientEnabled( enabled: boolean ) {

			options.ambient.enabled = enabled;
			refreshUniforms();

		},
		setAmbientIntensity( intensity: number ) {

			options.ambient.intensity = Math.max( 0, intensity );
			refreshUniforms();

		},
		setSunEnabled( enabled: boolean ) {

			options.sun.enabled = enabled;
			refreshUniforms();

		},
		setHeadlights( beams, splatMesh ) {

			const list = beams && beams.length > 0 ? beams : null;

			if ( ! attached || ! splatMesh || ! list ) {

				hlOn.value = 0;
				hl0Intensity.value = 0;
				hl1Intensity.value = 0;
				mesh?.updateVersion();
				return;

			}

			splatMesh.updateMatrixWorld( true );
			splatMesh.getWorldScale( _headScale );
			const worldScale = Math.max( Math.abs( _headScale.x ), 1e-6 );
			_headInv.copy( splatMesh.matrixWorld ).invert();
			writeHeadlightSlot( list[ 0 ], hl0Pos, hl0Dir, hl0Color, hl0Intensity, hl0CosOuter, hl0CosInner, hl0Dist, worldScale );
			writeHeadlightSlot( list[ 1 ], hl1Pos, hl1Dir, hl1Color, hl1Intensity, hl1CosOuter, hl1CosInner, hl1Dist, worldScale );
			hlOn.value = 1;
			mesh?.updateVersion();

		},
		setFloodLights( lights, splatMesh, night ) {

			let worldScale = 1;

			if ( splatMesh ) {

				splatMesh.updateMatrixWorld( true );
				splatMesh.getWorldScale( _headScale );
				worldScale = Math.max( Math.abs( _headScale.x ), 1e-6 );
				_headInv.copy( splatMesh.matrixWorld ).invert();

			}

			floodSlots.forEach( ( slot, index ) => {

				const light = night ? lights[ index ] : undefined;

				if ( ! light || light.intensity <= 0 || ! splatMesh ) {

					slot.size.value.w = 0;
					return;

				}

				_headPos.copy( light.position ).applyMatrix4( _headInv );
				_headDir.copy( light.direction ).transformDirection( _headInv );

				if ( _headDir.lengthSq() < 1e-8 ) {

					_headDir.set( 0, - 1, 0 );

				} else {

					_headDir.normalize();

				}

				slot.pos.value.copy( _headPos );
				slot.dir.value.copy( _headDir );
				slot.color.value.set( light.color.r, light.color.g, light.color.b );
				slot.size.value.set(
					Math.max( light.width, 0.05 ) / worldScale,
					Math.max( light.height, 0.05 ) / worldScale,
					Math.max( light.range, 0.05 ) / worldScale,
					Math.max( light.intensity, 0 )
				);
				slot.spread.value = Math.max( light.spread, 0 );
				slot.soft.value = THREE.MathUtils.clamp( light.softness, 0.02, 0.9 );

			} );

			mesh?.updateVersion();

		},
		setOcclusion( slots ) {

			occOn.value = slots ? 1 : 0;

			shadowSlots.forEach( ( slot, index ) => {

				const source = slots?.[ index ];

				if ( ! source ) {

					return;

				}

				slot.matrix.value.copy( source.matrix );
				( slot.map as { value: THREE.Texture } ).value = source.texture;

			} );

			mesh?.updateVersion();

		},
		getSunDirection() {

			return options.sun.direction.clone();

		},
		dispose() {

			attached = false;
			hlOn.value = 0;
			if ( mesh && mesh.objectModifier === lightingModifier ) {

				mesh.objectModifier = undefined;
				mesh.updateGenerator();
				mesh.updateVersion();

			}

			mesh = undefined;

		}
	};

	return handle;

};
