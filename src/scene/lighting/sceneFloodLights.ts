// 管理矩形照射灯参数、网格灯光与调试光柱。

import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import * as THREE from 'three';

/** 写进 3DGS 的矩形灯上限，和着色器槽位一致。 */
export const FLOOD_LIGHT_LIMIT = 4;

const BEAM_AXIS = new THREE.Vector3( 0, 0, 1 );
const _aim = new THREE.Vector3();
const _quat = new THREE.Quaternion();

RectAreaLightUniformsLib.init();

/** 矩形照射灯参数，位置和尺寸均使用世界单位。 */
export type SceneFloodLight = {
	/** 灯口中心的世界坐标。 */
	position: THREE.Vector3;
	/** 光束在世界空间中的朝向。 */
	direction: THREE.Vector3;
	/** 光束颜色。 */
	color: THREE.Color;
	/** 灯口宽度，世界单位。 */
	width: number;
	/** 灯口高度，世界单位。 */
	height: number;
	/** 照射距离，世界单位。 */
	range: number;
	/** 点云照射强度，非负值。 */
	intensity: number;
	/** 单侧张角，单位为弧度；0 表示等截面光柱。 */
	spread: number;
	/** 边缘和远端的过渡比例，范围为 0–1。 */
	softness: number;
	/** 是否显示用于调试的半透明照射范围。 */
	showVolume: boolean;
};

/** 在指定世界坐标创建朝下照射的矩形灯默认参数。 */
export const createFloodLight = ( position = new THREE.Vector3() ): SceneFloodLight => ( {
	position: position.clone(),
	direction: new THREE.Vector3( 0, - 1, 0 ),
	color: new THREE.Color( 0xfff1d0 ),
	width: 4,
	height: 2,
	range: 16,
	intensity: 1.4,
	spread: 0.18,
	softness: 0.28,
	showVolume: false
} );

const beamGeometry = ( light: SceneFloodLight ) => {

	const grow = Math.tan( Math.max( light.spread, 0 ) ) * light.range;
	const hw0 = light.width * 0.5;
	const hh0 = light.height * 0.5;
	const hw1 = hw0 + grow;
	const hh1 = hh0 + grow;
	const z = Math.max( light.range, 1e-3 );
	const positions = new Float32Array( [
		- hw0, - hh0, 0, hw0, - hh0, 0, hw0, hh0, 0, - hw0, hh0, 0,
		- hw1, - hh1, z, hw1, - hh1, z, hw1, hh1, z, - hw1, hh1, z
	] );
	const indices = [
		0, 1, 2, 0, 2, 3,
		4, 6, 5, 4, 7, 6,
		0, 4, 5, 0, 5, 1,
		1, 5, 6, 1, 6, 2,
		2, 6, 7, 2, 7, 3,
		3, 7, 4, 3, 4, 0
	];
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setIndex( indices );
	geometry.computeVertexNormals();
	return geometry;

};

/**
 * 矩形照射灯：点云着色用参数，网格用 RectAreaLight，光柱用半透明锥台。
 * 白天强度为 0，夜晚才亮。
 */
export class SceneFloodLights {

	/** 场景照射灯的参数列表。 */
	readonly lights: SceneFloodLight[] = [];
	private readonly group = new THREE.Group();
	private night = false;

	constructor( scene: THREE.Scene ) {

		this.group.name = 'scene-flood-lights';
		scene.add( this.group );

	}

	/** 添加并重建照射灯；达到数量上限时返回 undefined。 */
	add( position?: THREE.Vector3 ) {

		if ( this.lights.length >= FLOOD_LIGHT_LIMIT ) {

			return undefined;

		}

		const light = createFloodLight( position );
		this.lights.push( light );
		this.rebuild();
		return light;

	}

	/** 删除指定索引的照射灯并重建灯光对象。 */
	remove( index: number ) {

		if ( index < 0 || index >= this.lights.length ) {

			return;

		}

		this.lights.splice( index, 1 );
		this.rebuild();

	}

	/** 同步昼夜状态，夜间启用灯光强度，白天设为 0。 */
	setNight( night: boolean ) {

		if ( this.night === night ) {

			this.applyNight();
			return;

		}

		this.night = night;
		this.applyNight();

	}

	/** 根据当前参数重建网格灯光与调试光柱。 */
	rebuild() {

		this.disposeChildren();

		this.lights.forEach( ( light ) => {

			const direction = light.direction.clone();

			if ( direction.lengthSq() < 1e-8 ) {

				direction.set( 0, - 1, 0 );

			} else {

				direction.normalize();

			}

			light.direction.copy( direction );
			_quat.setFromUnitVectors( BEAM_AXIS, direction );

			const area = new THREE.RectAreaLight(
				light.color,
				this.night ? light.intensity * 12 : 0,
				Math.max( light.width, 0.05 ),
				Math.max( light.height, 0.05 )
			);
			area.position.copy( light.position );
			_aim.copy( light.position ).add( direction );
			area.lookAt( _aim );
			area.userData.excludeFromCollider = true;
			this.group.add( area );

			const volume = new THREE.Mesh(
				beamGeometry( light ),
				new THREE.MeshBasicMaterial( {
					color: light.color,
					transparent: true,
					opacity: 0.07,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
					side: THREE.DoubleSide,
					toneMapped: false
				} )
			);
			volume.position.copy( light.position );
			volume.quaternion.copy( _quat );
			volume.visible = light.showVolume;
			volume.frustumCulled = false;
			volume.userData.excludeFromCollider = true;
			this.group.add( volume );

		} );

	}

	/** 释放灯光与光柱资源，并移除场景节点。 */
	dispose() {

		this.disposeChildren();
		this.group.removeFromParent();

	}

	private applyNight() {

		let areaIndex = 0;
		let volumeIndex = 0;

		for ( const child of this.group.children ) {

			if ( child instanceof THREE.RectAreaLight ) {

				const light = this.lights[ areaIndex ];
				areaIndex += 1;
				child.intensity = this.night && light ? light.intensity * 12 : 0;
				if ( light ) {

					child.color.copy( light.color );
					child.width = Math.max( light.width, 0.05 );
					child.height = Math.max( light.height, 0.05 );
					child.position.copy( light.position );
					const direction = light.direction.clone().normalize();
					child.lookAt( light.position.clone().add( direction ) );

				}

			}

			if ( child instanceof THREE.Mesh ) {

				const light = this.lights[ volumeIndex ];
				volumeIndex += 1;
				child.visible = light?.showVolume ?? false;
				const material = child.material;

				if ( light && material instanceof THREE.MeshBasicMaterial ) {

					material.color.copy( light.color );

				}

			}

		}

	}

	private disposeChildren() {

		for ( const child of [ ...this.group.children ] ) {

			if ( child instanceof THREE.Mesh ) {

				child.geometry.dispose();
				const material = child.material;

				if ( Array.isArray( material ) ) {

					material.forEach( ( entry ) => entry.dispose() );

				} else {

					material.dispose();

				}

			}

			this.group.remove( child );

		}

	}

}
