// 根据天气和开关选择深度遮挡模式，协调场景的分遍渲染。

import * as THREE from 'three';
import {
	getColliderDepthMode,
	setColliderDepthMode,
	type ColliderDepthMode
} from './GroundShadowReceiver';

/** 决定碰撞深度模式的场景开关与可见状态。 */
export type ColliderDepthSyncState = {
	/** 碰撞体深度辅助层，资源未就绪时可为空。 */
	colliderDepth?: THREE.Object3D;
	/** 是否启用网格深度遮挡。 */
	meshDepthOcclusionEnabled: boolean;
	/** 是否启用降雨。 */
	rainEnabled: boolean;
	/** 是否启用降雪。 */
	snowEnabled: boolean;
	/** 积水表面是否可见。 */
	waterVisible: boolean;
};

/** 按开关与天气决定碰撞体深度层：mesh / particle / off。 */
export const syncColliderDepthMode = ( state: ColliderDepthSyncState ): ColliderDepthMode => {

	const { colliderDepth } = state;
	if ( ! colliderDepth ) {

		return 'off';

	}

	if ( state.meshDepthOcclusionEnabled ) {

		setColliderDepthMode( colliderDepth, 'mesh' );
		return 'mesh';

	}

	const needParticleDepth = state.rainEnabled || state.snowEnabled || state.waterVisible;
	const mode: ColliderDepthMode = needParticleDepth ? 'particle' : 'off';
	setColliderDepthMode( colliderDepth, mode );
	return mode;

};

/** 分遍渲染所需的场景对象与图层。 */
export type MeshDepthRenderArgs = {
	/** 当前场景渲染器。 */
	renderer: THREE.WebGLRenderer;
	/** 待绘制的主场景。 */
	scene: THREE.Scene;
	/** 主场景相机。 */
	camera: THREE.Camera;
	/** 第二遍写入深度的碰撞辅助层。 */
	colliderDepth?: THREE.Object3D;
	/** 第一遍隐藏、第二遍绘制的角色、接影与天气覆盖层。 */
	overlays: ReadonlyArray<THREE.Object3D | null | undefined>;
	/** 仅在第一遍绘制的高斯点、点云渲染器与天空。 */
	baseLayer: ReadonlyArray<THREE.Object3D | null | undefined>;
};

const collect = ( list: ReadonlyArray<THREE.Object3D | null | undefined> ) => {

	const objects: THREE.Object3D[] = [];
	for ( let i = 0; i < list.length; i ++ ) {

		const object = list[ i ];
		if ( object ) {

			objects.push( object );

		}

	}
	return objects;

};

/**
 * 网格深度遮挡启用时分两遍绘制：先绘制高斯点，再清空深度并叠加碰撞深度与覆盖层。
 * 分遍渲染可避免碰撞深度将高斯点裁除后露出天空。
 */
export const renderWithMeshDepthPass = ( args: MeshDepthRenderArgs ) => {

	const { renderer, scene, camera, colliderDepth } = args;
	if ( getColliderDepthMode( colliderDepth ) !== 'mesh' ) {

		renderer.render( scene, camera );
		return;

	}

	const overlays = collect( args.overlays );
	const baseLayer = collect( args.baseLayer );
	const overlayState = overlays.map( ( object ) => {

		const visible = object.visible;
		object.visible = false;
		return { object, visible };

	} );
	const baseState = baseLayer.map( ( object ) => ( {
		object,
		visible: object.visible
	} ) );
	const previousAutoClear = renderer.autoClear;

	try {

		renderer.render( scene, camera );

		for ( let i = 0; i < overlayState.length; i ++ ) {

			overlayState[ i ].object.visible = overlayState[ i ].visible;

		}

		for ( let i = 0; i < baseState.length; i ++ ) {

			baseState[ i ].object.visible = false;

		}

		renderer.autoClear = false;
		renderer.clear( false, true, false );
		renderer.render( scene, camera );

	} finally {

		renderer.autoClear = previousAutoClear;
		for ( let i = 0; i < overlayState.length; i ++ ) {

			overlayState[ i ].object.visible = overlayState[ i ].visible;

		}
		for ( let i = 0; i < baseState.length; i ++ ) {

			baseState[ i ].object.visible = baseState[ i ].visible;

		}

	}

};
