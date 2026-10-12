// 管理车辆近光、尾灯、刹车灯、体积光与灯口光晕。

import * as THREE from 'three';
import { SpotLightMaterial } from '@pmndrs/vanilla';
import type { VehicleInstance } from 'three-player-controller';
import type { SplatHeadlightBeam } from '../lighting/splatLighting';

/** 近光参数相对参考车长折算到当前车辆尺寸。 */
const REF_CAR_LENGTH = 4.3;
const SPOT_ANGLE = THREE.MathUtils.degToRad( 50 );
const BEAM_LENGTH = 23;
const SPOT_DISTANCE = 40;
const NEAR_RADIUS = 0.08;
const FAR_RADIUS = 3.7;
const BEAM_DROP = 0.67;
const SPOT_INTENSITY = 180;
const VOLUME_OPACITY = 0.42;
const VOLUME_ANGLE_POWER = 7;
const VOLUME_ATTENUATION = 5;
const BEAM_CONVERGE = 0.78;
/** 车灯是否对碰撞接影层 / 角色等网格投射 Three.js 阴影。不影响 3DGS 碰撞遮挡。 */
const HEADLIGHT_MESH_SHADOWS = false;

const LEFT_LAMP_NAMES = [ 'headlight-projector-l', 'headlights-led-l' ];
const RIGHT_LAMP_NAMES = [ 'headlight-projector-r', 'headlights-led-r' ];

/** 尾灯灯体底色，对齐模型红玻璃。刹车未踩时只靠这个底色，不靠自发光。 */
const TAIL_COLOR = 0xff0100;
const TAIL_EMISSIVE = 0xff2020;
const TAIL_RUNNING_INTENSITY = 12;
const TAIL_BRAKE_INTENSITY = 40;

type LampGlow = {
	color: number;
	emissive: number;
	intensity: number;
};

const HEAD_GLOW: LampGlow = {
	color: 0xfff5d7,
	emissive: 0xffd994,
	intensity: 40
};

const TAIL_GLOW: LampGlow = {
	color: TAIL_COLOR,
	emissive: TAIL_EMISSIVE,
	intensity: TAIL_RUNNING_INTENSITY
};

const BRAKE_GLOW: LampGlow = {
	color: TAIL_COLOR,
	emissive: TAIL_EMISSIVE,
	intensity: 0
};

type VolumeMaterial = InstanceType<typeof SpotLightMaterial>;

const UP = new THREE.Vector3( 0, 1, 0 );
const CYLINDER_AXIS = new THREE.Vector3( 0, - 1, 0 );

/** 生成左右对称的近光遮罩，截止线与光斑外缘平滑过渡。 */
const makeLowBeamCookie = () => {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 512;
	canvas.height = 512;
	const context = canvas.getContext( '2d' );

	if ( ! context ) {

		return new THREE.Texture();

	}

	context.fillStyle = '#000';
	context.fillRect( 0, 0, 512, 512 );

	const gradient = context.createRadialGradient( 256, 330, 12, 256, 330, 245 );
	gradient.addColorStop( 0, 'rgba(255,255,255,1)' );
	gradient.addColorStop( 0.35, 'rgba(255,255,255,.94)' );
	gradient.addColorStop( 0.72, 'rgba(155,155,155,.55)' );
	gradient.addColorStop( 1, 'rgba(0,0,0,0)' );
	context.fillStyle = gradient;
	context.fillRect( 0, 0, 512, 512 );

	// 聚光灯读取纹理 RGB，用黑色渐变柔化上方截止线和下方外缘。
	const cutoff = context.createLinearGradient( 0, 205, 0, 245 );
	cutoff.addColorStop( 0, 'rgba(0,0,0,1)' );
	cutoff.addColorStop( 1, 'rgba(0,0,0,0)' );
	context.fillStyle = cutoff;
	context.fillRect( 0, 0, 512, 512 );

	const bottomFade = context.createLinearGradient( 0, 460, 0, 512 );
	bottomFade.addColorStop( 0, 'rgba(0,0,0,0)' );
	bottomFade.addColorStop( 1, 'rgba(0,0,0,1)' );
	context.fillStyle = bottomFade;
	context.fillRect( 0, 0, 512, 512 );

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

};

const findNamedObject = ( root: THREE.Object3D, fragments: string[] ) => {

	let found: THREE.Object3D | undefined;

	root.traverse( ( child ) => {

		if ( found ) {

			return;

		}

		const name = child.name.toLowerCase();

		if ( fragments.every( ( fragment ) => name.includes( fragment ) ) ) {

			found = child;

		}

	} );

	return found;

};

const findLamp = ( root: THREE.Object3D, names: string[] ) => {

	for ( const name of names ) {

		const object = findNamedObject( root, [ name ] );

		if ( object ) {

			return object;

		}

	}

	return undefined;

};

const isHeadlampGlowMesh = ( name: string ) => {

	const lower = name.toLowerCase();

	if ( lower.includes( 'tail' ) || lower.includes( 'trim' ) || lower.includes( 'frame' ) ) {

		return false;

	}

	return lower.includes( 'headlight' )
		&& ( lower.includes( 'led' ) || lower.includes( 'cover' ) || lower.includes( 'drl' ) || lower.includes( 'projector' ) );

};

/** 常亮尾灯：车身 back-01、后备箱 back-trunk-02、主 LED。led-02 只在刹车时亮；lens 外玻璃不发光。 */
const isTailRunningMesh = ( name: string ) => {

	const lower = name.toLowerCase();

	if ( ! lower.includes( 'taillight' ) || lower.includes( 'trim' ) || lower.includes( 'frame' ) || lower.includes( 'lens' ) || lower.includes( 'led-02' ) ) {

		return false;

	}

	return lower.includes( 'led' ) || lower.includes( 'taillight-back' );

};

/** 左右各一盏，只在刹车时亮。 */
const isTailBrakeMesh = ( name: string ) => {

	const lower = name.toLowerCase();
	return lower.includes( 'taillight' ) && lower.includes( 'led-02' );

};

const makeLampMaterial = ( source: THREE.Material, cloned: THREE.Material[], glow: LampGlow ) => {

	const lamp = source instanceof THREE.MeshStandardMaterial
		? source.clone()
		: new THREE.MeshStandardMaterial();
	lamp.color.set( glow.color );
	lamp.emissive.set( glow.emissive );
	lamp.emissiveIntensity = glow.intensity;
	lamp.roughness = 0.12;
	lamp.metalness = 0.05;
	lamp.toneMapped = false;
	cloned.push( lamp );
	return lamp;

};

const applyEmissiveToMesh = ( mesh: THREE.Mesh, cloned: THREE.Material[], glow: LampGlow ) => {

	const sources = Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ];
	const next = sources.map( ( material ) => makeLampMaterial( material, cloned, glow ) );
	mesh.material = next.length === 1 ? next[ 0 ] : next;

};

/** 灯具名称可能位于父节点；需沿节点层级识别灯口，并兼容无光照玻璃材质。 */
const applyNamedEmissive = (
	root: THREE.Object3D,
	match: ( name: string ) => boolean,
	glow: LampGlow,
	cloned: THREE.Material[]
) => {

	const meshes = new Set<THREE.Mesh>();

	root.traverse( ( child ) => {

		if ( ! match( child.name ) ) {

			return;

		}

		child.traverse( ( object ) => {

			if ( ( object as THREE.Mesh ).isMesh ) {

				meshes.add( object as THREE.Mesh );

			}

		} );

	} );

	meshes.forEach( ( mesh ) => applyEmissiveToMesh( mesh, cloned, glow ) );

};

const excludeFromCollider = ( object: THREE.Object3D ) => {

	object.userData.excludeFromCollider = true;

};

/** 前灯灯口：LED / 日行灯 / 投射器，不含外玻璃。 */
const isHeadlampSpriteMesh = ( name: string ) => {

	const lower = name.toLowerCase();

	if ( lower.includes( 'tail' ) || lower.includes( 'trim' ) || lower.includes( 'frame' ) || lower.includes( 'cover' ) ) {

		return false;

	}

	return lower.includes( 'headlight' )
		&& ( lower.includes( 'led' ) || lower.includes( 'drl' ) || lower.includes( 'projector' ) );

};

const collectMatchedMeshes = ( root: THREE.Object3D, match: ( name: string ) => boolean ) => {

	const meshes = new Set<THREE.Mesh>();

	root.traverse( ( child ) => {

		if ( ! match( child.name ) ) {

			return;

		}

		child.traverse( ( object ) => {

			if ( ! ( object as THREE.Mesh ).isMesh ) {

				return;

			}

			const meshName = object.name.toLowerCase();

			if ( meshName.includes( 'cover' ) || meshName.includes( 'lens' ) || meshName.includes( 'trim' ) || meshName.includes( 'frame' ) ) {

				return;

			}

			meshes.add( object as THREE.Mesh );

		} );

	} );

	return meshes;

};

const makeGlowTexture = () => {

	const size = 128;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext( '2d' );

	if ( ! context ) {

		return new THREE.Texture();

	}

	const gradient = context.createRadialGradient( size / 2, size / 2, 0, size / 2, size / 2, size / 2 );
	gradient.addColorStop( 0, 'rgba(255,255,255,1)' );
	gradient.addColorStop( 0.22, 'rgba(255,255,255,0.85)' );
	gradient.addColorStop( 0.55, 'rgba(255,255,255,0.22)' );
	gradient.addColorStop( 1, 'rgba(255,255,255,0)' );
	context.fillStyle = gradient;
	context.fillRect( 0, 0, size, size );

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

};

const makeGlowMaterial = ( map: THREE.Texture, color: number, opacity: number ) => new THREE.SpriteMaterial( {
	map,
	color,
	transparent: true,
	opacity,
	depthTest: true,
	depthWrite: false,
	blending: THREE.AdditiveBlending,
	toneMapped: false
} );

/** 组合左右聚光灯与体积光锥，网格阴影仅由左灯按配置投射。 */
export class VehicleHeadlights {

	private readonly camera: THREE.PerspectiveCamera;
	private readonly cookie: THREE.Texture;
	private readonly volumeGeometry: THREE.BufferGeometry;
	private readonly lights: THREE.SpotLight[] = [];
	private readonly volumeMaterials: VolumeMaterial[] = [];
	private readonly lampMaterials: THREE.Material[] = [];
	private readonly brakeMaterials: THREE.Material[] = [];
	private readonly glowTexture: THREE.Texture;
	private readonly glowMaterials: THREE.SpriteMaterial[] = [];
	private readonly glowBaseOpacity: number[] = [];
	private readonly lampBaseIntensity: number[] = [];
	private readonly volumes: THREE.Object3D[] = [];
	private brakeGlow: THREE.SpriteMaterial | undefined;
	private readonly lamps: THREE.Object3D[] = [];
	private readonly objects: THREE.Object3D[] = [];
	private readonly splatBeams: SplatHeadlightBeam[] = [];
	private readonly worldPos = new THREE.Vector3();
	private readonly targetPos = new THREE.Vector3();
	private disposed = false;

	/** 左右近光是否均已挂载。 */
	get hasBeams() {

		return this.lamps.length === 2;

	}

	constructor(
		vehicle: VehicleInstance,
		camera: THREE.PerspectiveCamera,
		resolution: THREE.Vector2
	) {

		this.camera = camera;
		this.cookie = makeLowBeamCookie();
		this.glowTexture = makeGlowTexture();

		const group = vehicle.vehicleGroup;
		group.updateMatrixWorld( true );
		applyNamedEmissive( group, isHeadlampGlowMesh, HEAD_GLOW, this.lampMaterials );
		applyNamedEmissive( group, isTailRunningMesh, TAIL_GLOW, this.lampMaterials );
		applyNamedEmissive( group, isTailBrakeMesh, BRAKE_GLOW, this.brakeMaterials );
		this.lampMaterials.forEach( ( material ) => {

			this.lampBaseIntensity.push(
				material instanceof THREE.MeshStandardMaterial ? material.emissiveIntensity : 0
			);

		} );

		const forward = vehicle.forwardLocal.clone();

		if ( forward.lengthSq() < 1e-8 ) {

			forward.set( 0, 0, 1 );

		} else {

			forward.normalize();

		}

		this.addGlowSprites( group, collectMatchedMeshes( group, isHeadlampSpriteMesh ), 0xfff4d0, 0.7, 1, forward );
		this.addGlowSprites( group, collectMatchedMeshes( group, isTailRunningMesh ), 0xff3030, 0.75, 1, forward.clone().negate() );
		this.brakeGlow = this.addGlowSprites(
			group,
			collectMatchedMeshes( group, isTailBrakeMesh ),
			0xff2020,
			0,
			1.15,
			forward.clone().negate()
		);

		const leftLamp = findLamp( group, LEFT_LAMP_NAMES );
		const rightLamp = findLamp( group, RIGHT_LAMP_NAMES );

		if ( ! leftLamp || ! rightLamp ) {

			this.volumeGeometry = new THREE.BufferGeometry();
			this.applyLitState( false, false );
			console.warn( '未找到车灯网格，跳过近光挂载', {
				left: leftLamp?.name,
				right: rightLamp?.name
			} );
			return;

		}

		const scale = Math.max( vehicle.size.l, 1e-4 ) / REF_CAR_LENGTH;
		const beamLength = BEAM_LENGTH * scale;
		const distance = SPOT_DISTANCE * scale;
		const nearRadius = NEAR_RADIUS * scale;
		const farRadius = FAR_RADIUS * scale;
		const drop = BEAM_DROP * scale;

		this.volumeGeometry = new THREE.CylinderGeometry(
			nearRadius,
			farRadius,
			beamLength,
			64,
			10,
			true
		);

		const right = new THREE.Vector3().crossVectors( UP, forward );

		if ( right.lengthSq() < 1e-8 ) {

			right.set( 1, 0, 0 );

		} else {

			right.normalize();

		}

		this.addBeam( group, leftLamp, forward, right, beamLength, distance, drop, resolution, HEADLIGHT_MESH_SHADOWS );
		this.addBeam( group, rightLamp, forward, right, beamLength, distance, drop, resolution, false );
		this.applyLitState( false, false );

	}

	/**
	 * 每帧更新体积光与高斯点光束的世界坐标，并同步昼夜和刹车状态。
	 *
	 * @param braking - 驾驶状态下是否按下刹车键。
	 * @param lit - 夜晚时为 true，与人物是否在车上无关。
	 */
	update( braking = false, lit = false ) {

		if ( this.disposed ) {

			return;

		}

		this.applyLitState( lit, braking );

		this.lamps.forEach( ( lamp, index ) => {

			lamp.getWorldPosition( this.worldPos );
			const material = this.volumeMaterials[ index ];

			if ( material ) {

				if ( material.spotPosition && typeof material.spotPosition.copy === 'function' ) {

					material.spotPosition.copy( this.worldPos );

				} else {

					material.spotPosition = this.worldPos.clone();

				}

			}

			const light = this.lights[ index ];
			const beam = this.splatBeams[ index ];

			if ( ! light || ! beam ) {

				return;

			}

			light.getWorldPosition( beam.worldPosition );
			light.target.updateWorldMatrix( true, false );
			light.target.getWorldPosition( this.targetPos );
			beam.worldDirection.subVectors( this.targetPos, beam.worldPosition );

			if ( beam.worldDirection.lengthSq() < 1e-8 ) {

				beam.worldDirection.set( 0, 0, - 1 );

			} else {

				beam.worldDirection.normalize();

			}

			beam.color.copy( light.color );
			beam.intensity = light.intensity;
			beam.angle = light.angle;
			beam.penumbra = light.penumbra;
			beam.distance = light.distance;

		} );

	}

	/** 返回左右近光的世界空间参数对象，供高斯点光照读取。 */
	getSplatBeams() {

		return this.splatBeams;

	}

	/**
	 * 画布尺寸变化时同步体积光深度参数。
	 *
	 * @param width - CSS 像素宽。
	 * @param height - CSS 像素高。
	 */
	setSize( width: number, height: number ) {

		this.volumeMaterials.forEach( ( material ) => {

			material.cameraNear = this.camera.near;
			material.cameraFar = this.camera.far;

			if ( material.resolution && typeof material.resolution.set === 'function' ) {

				material.resolution.set( width, height );

			}

		} );

	}

	/** 移除车灯与光晕对象，释放纹理、体积光几何和材质。 */
	dispose() {

		if ( this.disposed ) {

			return;

		}

		this.disposed = true;

		this.objects.forEach( ( object ) => {

			object.removeFromParent();

		} );

		this.lights.forEach( ( light ) => {

			light.map = null;
			light.shadow.map?.dispose();
			light.dispose();

		} );

		this.volumeMaterials.forEach( ( material ) => material.dispose() );
		this.lampMaterials.forEach( ( material ) => material.dispose() );
		this.brakeMaterials.forEach( ( material ) => material.dispose() );
		this.glowMaterials.forEach( ( material ) => material.dispose() );
		this.glowTexture.dispose();
		this.volumeGeometry.dispose();
		this.cookie.dispose();
		this.lights.length = 0;
		this.volumeMaterials.length = 0;
		this.lampMaterials.length = 0;
		this.brakeMaterials.length = 0;
		this.glowMaterials.length = 0;
		this.glowBaseOpacity.length = 0;
		this.lampBaseIntensity.length = 0;
		this.volumes.length = 0;
		this.brakeGlow = undefined;
		this.lamps.length = 0;
		this.objects.length = 0;
		this.splatBeams.length = 0;

	}

	/**
	 * 根据点亮状态控制近光、尾灯与光晕，关闭时恢复灯体底色。
	 *
	 * @param lit - 是否点亮。
	 * @param braking - 点亮时是否再亮刹车灯。
	 */
	private applyLitState( lit: boolean, braking: boolean ) {

		this.lampMaterials.forEach( ( material, index ) => {

			if ( ! ( material instanceof THREE.MeshStandardMaterial ) ) {

				return;

			}

			material.emissiveIntensity = lit ? ( this.lampBaseIntensity[ index ] ?? 0 ) : 0;
			material.toneMapped = ! lit;

		} );

		this.brakeMaterials.forEach( ( material ) => {

			if ( ! ( material instanceof THREE.MeshStandardMaterial ) ) {

				return;

			}

			material.emissiveIntensity = lit && braking ? TAIL_BRAKE_INTENSITY : 0;
			material.toneMapped = ! lit;

		} );

		this.glowMaterials.forEach( ( material, index ) => {

			if ( material === this.brakeGlow ) {

				material.opacity = lit && braking ? 0.9 : 0;
				return;

			}

			material.opacity = lit ? ( this.glowBaseOpacity[ index ] ?? 0 ) : 0;

		} );

		this.lights.forEach( ( light ) => {

			light.visible = lit;
			light.intensity = lit ? SPOT_INTENSITY : 0;

		} );

		this.volumes.forEach( ( volume ) => {

			volume.visible = lit;

		} );

	}

	/** 在灯口前创建面向相机的加色光晕，并通过深度测试接受车身遮挡。 */
	private addGlowSprites(
		group: THREE.Group,
		meshes: Set<THREE.Mesh>,
		color: number,
		opacity: number,
		sizeScale: number,
		outwardLocal: THREE.Vector3
	) {

		const material = makeGlowMaterial( this.glowTexture, color, opacity );
		this.glowMaterials.push( material );
		this.glowBaseOpacity.push( opacity );
		const outward = outwardLocal.clone().transformDirection( group.matrixWorld );
		const box = new THREE.Box3();
		const size = new THREE.Vector3();
		const center = new THREE.Vector3();

		meshes.forEach( ( mesh ) => {

			box.setFromObject( mesh );
			box.getSize( size );
			box.getCenter( center );
			const dims = [ size.x, size.y, size.z ].sort( ( a, b ) => a - b );
			const depth = dims[ 0 ];
			const face = Math.max( dims[ 1 ], dims[ 2 ], 1e-4 );
			center.addScaledVector( outward, depth * 0.65 );
			group.worldToLocal( center );

			const sprite = new THREE.Sprite( material );
			sprite.position.copy( center );
			sprite.scale.setScalar( face * 1 * sizeScale );
			sprite.renderOrder = 2;
			excludeFromCollider( sprite );
			group.add( sprite );
			this.objects.push( sprite );

		} );

		return material;

	}

	private addBeam(
		group: THREE.Group,
		lamp: THREE.Object3D,
		forward: THREE.Vector3,
		right: THREE.Vector3,
		beamLength: number,
		distance: number,
		drop: number,
		resolution: THREE.Vector2,
		castShadow: boolean
	) {

		const start = group.worldToLocal( lamp.getWorldPosition( new THREE.Vector3() ) );
		const lampSize = new THREE.Box3().setFromObject( lamp ).getSize( new THREE.Vector3() );
		start.addScaledVector( forward, Math.max( lampSize.x, lampSize.y, lampSize.z ) * 1.4 );
		const side = start.dot( right );
		const aim = ( length: number ) => {

			const end = start.clone().addScaledVector( forward, length );
			end.addScaledVector( right, - side * BEAM_CONVERGE );
			end.y -= drop * ( length / Math.max( distance, 1e-4 ) );
			return end;

		};

		const targetPos = aim( distance );
		const beamEnd = aim( beamLength );

		const light = new THREE.SpotLight(
			0xffffff,
			SPOT_INTENSITY,
			distance,
			SPOT_ANGLE,
			0.52,
			1.35
		);
		light.position.copy( start );
		light.map = this.cookie;
		light.castShadow = castShadow;

		if ( castShadow ) {

			light.shadow.mapSize.set( 1024, 1024 );
			light.shadow.camera.near = Math.max( distance * ( 0.15 / SPOT_DISTANCE ), 1e-4 );
			light.shadow.camera.far = distance + 2 * ( distance / SPOT_DISTANCE );
			light.shadow.bias = - 0.001;
			light.shadow.normalBias = 0.018;

		}

		const target = new THREE.Object3D();
		target.position.copy( targetPos );
		excludeFromCollider( target );
		group.add( target );
		light.target = target;
		excludeFromCollider( light );
		group.add( light );

		const volumeMat = new SpotLightMaterial( {
			opacity: VOLUME_OPACITY,
			attenuation: VOLUME_ATTENUATION * ( beamLength / BEAM_LENGTH ),
			anglePower: VOLUME_ANGLE_POWER,
			spotPosition: new THREE.Vector3(),
			lightColor: new THREE.Color( 0xffffff ),
			cameraNear: this.camera.near,
			cameraFar: this.camera.far,
			depth: null,
			resolution: resolution.clone(),
			transparent: true,
			depthWrite: false
		} ) as VolumeMaterial;
		volumeMat.side = THREE.DoubleSide;
		volumeMat.depthWrite = false;

		const volume = new THREE.Mesh( this.volumeGeometry, volumeMat );
		const direction = beamEnd.clone().sub( start );

		if ( direction.lengthSq() > 1e-8 ) {

			volume.position.copy( start ).add( beamEnd ).multiplyScalar( 0.5 );
			volume.quaternion.setFromUnitVectors( CYLINDER_AXIS, direction.normalize() );

		} else {

			volume.position.copy( start );

		}

		excludeFromCollider( volume );
		volume.castShadow = false;
		volume.receiveShadow = false;
		volume.frustumCulled = false;
		group.add( volume );

		this.lights.push( light );
		this.volumes.push( volume );
		this.volumeMaterials.push( volumeMat );
		this.lamps.push( lamp );
		this.objects.push( light, target, volume );
		this.splatBeams.push( {
			worldPosition: new THREE.Vector3(),
			worldDirection: new THREE.Vector3( 0, 0, - 1 ),
			color: light.color.clone(),
			intensity: light.intensity,
			angle: light.angle,
			penumbra: light.penumbra,
			distance: light.distance
		} );

	}

}

/**
 * 在已加载车辆上挂近光。找不到灯具网格时返回 undefined。
 *
 * @param vehicle - 控制器里的车辆实例。
 * @param camera - 当前场景相机。
 * @param resolution - 画布 CSS 像素尺寸。
 */
export const attachVehicleHeadlights = (
	vehicle: VehicleInstance,
	camera: THREE.PerspectiveCamera,
	resolution: THREE.Vector2
) => {

	const headlights = new VehicleHeadlights( vehicle, camera, resolution );

	if ( headlights.hasBeams ) {

		return headlights;

	}

	headlights.dispose();
	return undefined;

};
