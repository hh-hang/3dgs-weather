// 基于碰撞网格创建接影材质、深度遮挡层与调试线框。

import * as THREE from 'three';

const RECEIVER_RENDER_ORDER = 1002;
const DEPTH_NAME = '__colliderDepth';
/** 先绘制高斯点，再写入碰撞深度，供后续天气粒子和水层进行遮挡测试。 */
const DEPTH_RENDER_ORDER = 10;
/** 不透明队列最前：先写碰撞体深度，再画角色 / 车辆。 */
const MESH_DEPTH_PREPASS_ORDER = -1000;

/** 深度遮挡模式：关闭、透明层遮挡或网格遮挡。 */
export type ColliderDepthMode = 'off' | 'particle' | 'mesh';

/**
 * 为碰撞网格启用透明接影。
 * 使用较高的绘制顺序，在高斯点透明绘制之后叠加阴影。
 *
 * @param root - 碰撞体根节点。
 * @param opacity - 影子不透明度。
 */
export const bindColliderShadowReceivers = ( root: THREE.Object3D, opacity = 0.4 ) => {

	root.traverse( ( object ) => {

		if ( ! ( object instanceof THREE.Mesh ) ) {

			return;

		}

		const previous = object.material;
		// 碰撞地面变换后可能朝下，双面接影避免从上方被剔除。
		const material = new THREE.ShadowMaterial( {
			opacity,
			side: THREE.DoubleSide,
			forceSinglePass: true,
			transparent: true,
			depthWrite: false,
			depthTest: true
		} );
		material.polygonOffset = true;
		material.polygonOffsetFactor = - 1;
		material.polygonOffsetUnits = - 1;

		object.material = material;
		object.castShadow = true;
		object.receiveShadow = true;
		object.renderOrder = RECEIVER_RENDER_ORDER;
		object.frustumCulled = false;

		const materials = Array.isArray( previous ) ? previous : [ previous ];

		for ( let i = 0; i < materials.length; i ++ ) {

			materials[ i ]?.dispose();

		}

	} );

};

/**
 * 创建只写深度的辅助层，与碰撞体共用几何并保持变换对齐。
 * 默认关闭；可切换为透明层遮挡或网格遮挡，后者配合分遍渲染使用。
 *
 * @param root - 碰撞体根节点。
 * @returns 与 root 对齐的深度组。没有网格时组为空。
 */
export const createColliderDepthOccluder = ( root: THREE.Object3D ) => {

	const group = new THREE.Group();
	group.name = DEPTH_NAME;

	const material = new THREE.MeshBasicMaterial( {
		colorWrite: false,
		depthWrite: true,
		depthTest: true,
		side: THREE.DoubleSide,
		transparent: true,
		fog: false,
		toneMapped: false
	} );

	root.updateWorldMatrix( true, true );
	const rootInverse = new THREE.Matrix4().copy( root.matrixWorld ).invert();
	const local = new THREE.Matrix4();

	root.traverse( ( object ) => {

		if ( ! ( object instanceof THREE.Mesh ) ) {

			return;

		}

		const mesh = new THREE.Mesh( object.geometry, material );
		mesh.name = DEPTH_NAME;
		local.copy( object.matrixWorld ).premultiply( rootInverse );
		local.decompose( mesh.position, mesh.quaternion, mesh.scale );
		mesh.renderOrder = DEPTH_RENDER_ORDER;
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.raycast = () => {};
		group.add( mesh );

	} );

	group.position.copy( root.position );
	group.quaternion.copy( root.quaternion );
	group.scale.copy( root.scale );
	group.visible = false;
	group.userData.colliderDepthMode = 'off' satisfies ColliderDepthMode;
	group.userData.colliderDepthMaterial = material;
	return group;

};

/** 切换碰撞深度模式：off 关闭，particle 遮挡透明层，mesh 配合两遍绘制遮挡网格。 */
export const setColliderDepthMode = ( group: THREE.Object3D, mode: ColliderDepthMode ) => {

	if ( group.userData.colliderDepthMode === mode ) {

		return;

	}

	group.userData.colliderDepthMode = mode;
	group.visible = mode !== 'off';

	if ( mode === 'off' ) {

		return;

	}

	const opaque = mode === 'mesh';
	const order = opaque ? MESH_DEPTH_PREPASS_ORDER : DEPTH_RENDER_ORDER;
	const material = group.userData.colliderDepthMaterial as THREE.MeshBasicMaterial | undefined;

	if ( material ) {

		material.transparent = ! opaque;
		material.needsUpdate = true;

	}

	group.traverse( ( object ) => {

		if ( object instanceof THREE.Mesh ) {

			object.renderOrder = order;

		}

	} );

};

/** 读取碰撞深度模式；辅助层未就绪时返回关闭状态。 */
export const getColliderDepthMode = ( group: THREE.Object3D | undefined ): ColliderDepthMode => {

	if ( ! group ) {

		return 'off';

	}

	return ( group.userData.colliderDepthMode as ColliderDepthMode | undefined ) ?? 'off';

};

/** 与碰撞体共用几何的可视线框，不参与碰撞或阴影计算。 */
export const createColliderWireframe = ( root: THREE.Object3D ) => {

	const group = createColliderDepthOccluder( root );
	group.name = 'ColliderWireframe';
	delete group.userData.colliderDepthMode;
	delete group.userData.colliderDepthMaterial;
	group.traverse( ( object ) => {

		object.userData.excludeFromCollider = true;
		if ( ! ( object instanceof THREE.Mesh ) ) return;
		object.name = 'ColliderWireframe';
		object.renderOrder = RECEIVER_RENDER_ORDER + 1;
		const material = object.material as THREE.MeshBasicMaterial;
		material.color.set( 0x00ff99 );
		material.colorWrite = true;
		material.depthWrite = false;
		material.depthTest = false;
		material.wireframe = true;
		material.opacity = 0.35;
		material.toneMapped = false;
		material.forceSinglePass = true;

	} );
	return group;

};

/**
 * 移除深度或线框辅助层，仅释放材质，保留碰撞体持有的共享几何。
 *
 * @param group - 与碰撞体共用几何的辅助层。
 */
export const disposeColliderDepthOccluder = ( group: THREE.Object3D | undefined ) => {

	if ( ! group ) {

		return;

	}

	group.removeFromParent();
	const materials = new Set<THREE.Material>();

	group.traverse( ( object ) => {

		if ( ! ( object instanceof THREE.Mesh ) ) {

			return;

		}

		const list = Array.isArray( object.material ) ? object.material : [ object.material ];

		for ( let i = 0; i < list.length; i ++ ) {

			const material = list[ i ];

			if ( material ) {

				materials.add( material );

			}

		}

	} );

	materials.forEach( ( material ) => material.dispose() );

};
