// 从灯光视角生成碰撞体深度图，供高斯点计算光照遮挡。

import * as THREE from 'three';
import { FLOOD_LIGHT_LIMIT, type SceneFloodLight } from '../lighting/sceneFloodLights';
import type { SplatHeadlightBeam } from '../lighting/splatLighting';

const MAP_SIZE = 512;
const HEADLIGHT_SLOTS = 2;
/** 灯光深度图槽位总数：两盏车灯加矩形照射灯上限。 */
export const LIGHT_SHADOW_SLOTS = HEADLIGHT_SLOTS + FLOOD_LIGHT_LIMIT;

const _up = new THREE.Vector3( 0, 1, 0 );
const _altUp = new THREE.Vector3( 0, 0, 1 );
const _aim = new THREE.Vector3();
const _bias = new THREE.Matrix4().set(
	0.5, 0, 0, 0.5,
	0, 0.5, 0, 0.5,
	0, 0, 0.5, 0.5,
	0, 0, 0, 1
);

/** 单盏灯的碰撞体深度贴图与投影变换。 */
export type LightShadowSlot = {
	/** 将高斯点局部坐标投影到灯光深度纹理的矩阵。 */
	matrix: THREE.Matrix4;
	/** 灯光视角下的碰撞体深度纹理。 */
	texture: THREE.Texture;
};

/** 从每盏灯看碰撞体，写成深度图。点云着色用它挡住光，不让高斯互相遮挡。 */
export class ColliderLightShadows {

	private readonly targets: THREE.WebGLRenderTarget[] = [];
	private readonly perspective = new THREE.PerspectiveCamera( 50, 1, 0.05, 40 );
	private readonly ortho = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0.05, 16 );
	private readonly scratch = new THREE.Matrix4();
	/** 按车灯、照射灯顺序排列的深度图槽位。 */
	readonly slots: LightShadowSlot[];

	constructor() {

		const placeholder = new THREE.DataTexture( new Float32Array( [ 1, 1, 1, 1 ] ), 1, 1 );
		placeholder.needsUpdate = true;
		this.slots = Array.from( { length: LIGHT_SHADOW_SLOTS }, () => ( {
			matrix: new THREE.Matrix4(),
			texture: placeholder
		} ) );

		for ( let i = 0; i < LIGHT_SHADOW_SLOTS; i ++ ) {

			const target = new THREE.WebGLRenderTarget( MAP_SIZE, MAP_SIZE );
			target.depthTexture = new THREE.DepthTexture( MAP_SIZE, MAP_SIZE );
			target.depthTexture.format = THREE.DepthFormat;
			target.depthTexture.type = THREE.UnsignedShortType;
			target.depthTexture.magFilter = THREE.NearestFilter;
			target.depthTexture.minFilter = THREE.NearestFilter;
			target.depthTexture.wrapS = THREE.ClampToEdgeWrapping;
			target.depthTexture.wrapT = THREE.ClampToEdgeWrapping;
			this.targets.push( target );
			this.slots[ i ].texture = target.depthTexture;

		}

	}

	/** 把碰撞深度层画进各灯的深度图，并写出从 splat 局部坐标到阴影 uv 的矩阵。 */
	update(
		renderer: THREE.WebGLRenderer,
		occluder: THREE.Object3D | undefined,
		splatWorld: THREE.Matrix4 | undefined,
		headlights: SplatHeadlightBeam[] | null,
		floods: SceneFloodLight[],
		night: boolean
	) {

		const previousTarget = renderer.getRenderTarget();
		const previousAutoClear = renderer.autoClear;
		const wasVisible = occluder?.visible ?? false;

		if ( occluder ) {

			occluder.visible = true;
			occluder.updateWorldMatrix( true, true );

		}

		renderer.autoClear = true;

		for ( let i = 0; i < LIGHT_SHADOW_SLOTS; i ++ ) {

			const target = this.targets[ i ];
			renderer.setRenderTarget( target );
			renderer.clear();

			const camera = this.fitCamera( i, headlights, floods, night );

			if ( ! camera || ! occluder || ! splatWorld ) {

				continue;

			}

			renderer.render( occluder, camera );
			this.scratch.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
			this.scratch.multiply( splatWorld );
			this.slots[ i ].matrix.multiplyMatrices( _bias, this.scratch );

		}

		if ( occluder ) {

			occluder.visible = wasVisible;

		}

		renderer.setRenderTarget( previousTarget );
		renderer.autoClear = previousAutoClear;

	}

	/** 释放各灯光视角的深度渲染目标。 */
	dispose() {

		this.targets.forEach( ( target ) => target.dispose() );

	}

	private fitCamera(
		index: number,
		headlights: SplatHeadlightBeam[] | null,
		floods: SceneFloodLight[],
		night: boolean
	) {

		if ( index < HEADLIGHT_SLOTS ) {

			const beam = night ? headlights?.[ index ] : undefined;

			if ( ! beam || beam.intensity <= 0 || beam.worldDirection.lengthSq() < 1e-8 ) {

				return null;

			}

			const camera = this.perspective;
			camera.fov = THREE.MathUtils.radToDeg( Math.max( beam.angle, 0.05 ) * 2 );
			camera.near = 0.05;
			camera.far = Math.max( beam.distance, camera.near + 0.1 );
			camera.position.copy( beam.worldPosition );
			camera.up.copy( Math.abs( beam.worldDirection.y ) > 0.92 ? _altUp : _up );
			_aim.copy( beam.worldPosition ).add( beam.worldDirection );
			camera.lookAt( _aim );
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld();
			return camera;

		}

		const light = night ? floods[ index - HEADLIGHT_SLOTS ] : undefined;

		if ( ! light || light.intensity <= 0 || light.direction.lengthSq() < 1e-8 ) {

			return null;

		}

		const grow = Math.tan( Math.max( light.spread, 0 ) ) * light.range;
		const halfWidth = light.width * 0.5 + grow;
		const halfHeight = light.height * 0.5 + grow;
		const camera = this.ortho;
		camera.left = - halfWidth;
		camera.right = halfWidth;
		camera.top = halfHeight;
		camera.bottom = - halfHeight;
		camera.near = 0.05;
		camera.far = Math.max( light.range, camera.near + 0.1 );
		camera.position.copy( light.position );
		camera.up.copy( Math.abs( light.direction.y ) > 0.92 ? _altUp : _up );
		_aim.copy( light.position ).add( light.direction );
		camera.lookAt( _aim );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();
		return camera;

	}

}
