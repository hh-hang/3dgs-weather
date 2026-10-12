// 管理积水贴片的位姿控件，并协调拖拽与环视相机操作。

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PuddlePatchSystem } from '../weather/puddlePatchSystem';
import type { ScenePuddleTransformMode } from './sceneDebugGui';

/** 为积水贴片提供平移、旋转和缩放控件。 */
export class PuddleTransformTools {

	private controls?: TransformControls;
	private helper?: THREE.Object3D;
	/** 当前操作的贴片索引；null 表示未选中。 */
	enabledPatchIndex: number | null = null;
	/** 当前位姿控件的操作模式。 */
	mode: ScenePuddleTransformMode = 'translate';
	private orbitWasEnabled = false;

	constructor(
		private readonly getScene: () => THREE.Scene | undefined,
		private readonly getCamera: () => THREE.PerspectiveCamera | undefined,
		private readonly getRenderer: () => THREE.WebGLRenderer | undefined,
		private readonly getOrbit: () => OrbitControls | undefined,
		private readonly getPuddle: () => PuddlePatchSystem | undefined,
		private readonly getViewerMode: () => 'view' | 'walk',
		private readonly onStopAutoRotate: () => void,
		private readonly onChanged: () => void
	) {}

	/** 挂载或移除指定贴片的位姿控件。 */
	setEnabled( index: number, enabled: boolean ) {

		if ( ! enabled ) {

			if ( this.enabledPatchIndex === index || this.enabledPatchIndex !== null ) {

				this.controls?.detach();
				this.enabledPatchIndex = null;

			}
			return;

		}

		const transform = this.ensure();
		const object = this.getPuddle()?.getPatchTransformObject( index );
		if ( ! transform || ! object ) {

			return;

		}

		this.enabledPatchIndex = index;
		transform.setMode( this.mode );
		transform.attach( object );

	}

	/** 设置平移、旋转或缩放模式。 */
	setMode( mode: ScenePuddleTransformMode ) {

		this.mode = mode;
		this.controls?.setMode( mode );

	}

	/** 返回用于主渲染分层的位姿辅助对象。 */
	getHelper() {

		return this.helper;

	}

	/** 释放位姿控件，移除辅助对象并恢复环视输入状态。 */
	dispose() {

		const orbit = this.getOrbit();
		if ( orbit && this.controls?.dragging ) {

			orbit.enabled = this.orbitWasEnabled && this.getViewerMode() === 'view';

		}

		this.controls?.detach();
		this.controls?.dispose();
		if ( this.helper ) {

			this.getPuddle()?.removeHideObject( this.helper );
			this.helper.removeFromParent();

		}

		this.controls = undefined;
		this.helper = undefined;
		this.enabledPatchIndex = null;

	}

	private ensure() {

		if ( this.controls ) {

			return this.controls;

		}

		const scene = this.getScene();
		const camera = this.getCamera();
		const renderer = this.getRenderer();
		const puddle = this.getPuddle();
		if ( ! scene || ! camera || ! renderer || ! puddle ) {

			return undefined;

		}

		const transform = new TransformControls( camera, renderer.domElement );
		transform.setMode( this.mode );
		transform.setSpace( 'world' );
		transform.size = 0.85;
		const helper = transform.getHelper();
		helper.name = 'PuddlePatchTransformControls';
		helper.traverse( ( object ) => {

			object.userData.excludeFromCollider = true;

		} );
		transform.addEventListener( 'objectChange', () => {

			if ( this.enabledPatchIndex === null ) {

				return;

			}

			this.getPuddle()?.syncPatchFromTransformObject( this.enabledPatchIndex );

		} );
		transform.addEventListener( 'mouseUp', () => {

			if ( this.enabledPatchIndex === null ) {

				return;

			}

			this.getPuddle()?.syncPatchFromTransformObject( this.enabledPatchIndex );
			this.onChanged();

		} );
		transform.addEventListener( 'dragging-changed', ( event ) => {

			const dragging = Boolean( event.value );
			const orbit = this.getOrbit();
			if ( ! orbit ) {

				return;

			}

			if ( dragging ) {

				this.orbitWasEnabled = orbit.enabled;
				orbit.enabled = false;
				this.onStopAutoRotate();

			} else {

				orbit.enabled = this.orbitWasEnabled && this.getViewerMode() === 'view';

			}

		} );
		scene.add( helper );
		puddle.addHideObject( helper );
		this.controls = transform;
		this.helper = helper;
		return transform;

	}

}
