// 处理高斯点拾取、坐标记录、场景标记与剪贴板复制。

import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { LocalizedText } from '../../i18n';
import { SCENE_EFFECT_CONFIG } from '../sceneEffectConfig';

/** 拾取工具向调试面板同步状态的接口。 */
export type SplatPickGui = {
	/** 同步点击拾取开关。 */
	setPickArmed: ( armed: boolean ) => void;
	/** 同步拾取状态文本。 */
	setPickStatus: ( status: LocalizedText ) => void;
	/** 同步全部坐标显示文本。 */
	setPickLines: ( lines: string[] ) => void;
};

/** 管理点云拾取状态、世界坐标记录与可视标记。 */
export class SplatPickTools {

	/** 是否允许点击场景拾取。 */
	armed = false;
	/** 是否正在处理拾取请求。 */
	busy = false;
	/** 当前拾取状态文本。 */
	status: LocalizedText = { key: 'pick.off' };
	/** 按拾取顺序保存的世界坐标。 */
	readonly points: THREE.Vector3[] = [];
	private markers?: THREE.Group;
	private markerGeometry?: THREE.SphereGeometry;
	private markerMaterial?: THREE.MeshBasicMaterial;
	private readonly raycaster = new THREE.Raycaster();
	private pointer: { x: number; y: number; id: number } | null = null;
	private gui?: SplatPickGui | null;
	private disposed = false;

	constructor(
		private readonly stage: HTMLElement,
		private readonly getScene: () => THREE.Scene | undefined,
		private readonly getCamera: () => THREE.PerspectiveCamera | undefined,
		private readonly getSplat: () => SplatMesh | undefined,
		private readonly isDebugEnabled: () => boolean,
		private readonly onStopAutoRotate: () => void
	) {

		this.stage.addEventListener( 'pointerdown', this.onPointerDown );
		this.stage.addEventListener( 'pointerup', this.onPointerUp );

	}

	/** 绑定或移除拾取状态的面板同步接口。 */
	setGui( gui: SplatPickGui | null | undefined ) {

		this.gui = gui;

	}

	/** 切换拾取状态与鼠标样式，启用时停止环视自动旋转。 */
	setArmed( armed: boolean, controls?: { autoRotate: boolean } ) {

		this.armed = armed && this.isDebugEnabled();
		this.stage.style.cursor = this.armed ? 'crosshair' : '';
		if ( this.armed && controls ) {

			controls.autoRotate = false;
			this.onStopAutoRotate();

		}
		if ( ! this.armed && typeof this.status !== 'string' && this.status.key === 'pick.ready' ) {

			this.status = { key: 'pick.off' };

		}
		if ( this.armed ) {

			this.status = { key: 'pick.ready' };

		}
		this.gui?.setPickArmed( this.armed );
		this.gui?.setPickStatus( this.status );

	}

	/** 按调试状态挂载或隐藏拾取标记。 */
	syncMarkers() {

		if ( ! this.markers ) {

			if ( this.isDebugEnabled() ) {

				for ( const point of this.points ) {

					this.addMarker( point );

				}

			}
			return;

		}

		if ( ! this.isDebugEnabled() ) {

			this.markers.removeFromParent();
			return;

		}

		this.getScene()?.add( this.markers );

	}

	/** 清空坐标与标记，并释放标记资源。 */
	clear() {

		this.points.length = 0;
		this.status = { key: this.armed ? 'pick.ready' : 'pick.off' };
		this.markers?.clear();
		this.markerGeometry?.dispose();
		this.markerMaterial?.dispose();
		this.markerGeometry = undefined;
		this.markerMaterial = undefined;
		this.markers?.removeFromParent();
		this.markers = undefined;
		this.gui?.setPickStatus( this.status );
		this.gui?.setPickLines( [] );

	}

	/** 复制全部坐标；剪贴板写入失败时将坐标显示为状态文本。 */
	async copy() {

		const text = this.lines().join( '\n' );
		if ( ! text ) {

			this.status = { key: 'pick.noCoordinates' };
			this.gui?.setPickStatus( this.status );
			return;

		}

		try {

			await navigator.clipboard.writeText( text );
			this.status = { key: 'pick.copied' };
			this.gui?.setPickStatus( this.status );

		} catch {

			this.status = text;
			this.gui?.setPickStatus( this.status );

		}

	}

	/** 将拾取坐标格式化为保留三位小数的文本列表。 */
	lines() {

		return this.points.map( ( point ) => this.formatPoint( point ) );

	}

	/** 返回用于主渲染分层的拾取标记组。 */
	getMarkers() {

		return this.markers;

	}

	/** 更新拾取状态并同步面板。 */
	setStatus( status: LocalizedText ) {

		this.status = status;
		this.gui?.setPickStatus( status );

	}

	/** 移除拾取监听并清理坐标与标记资源。 */
	dispose() {

		this.disposed = true;
		this.stage.removeEventListener( 'pointerdown', this.onPointerDown );
		this.stage.removeEventListener( 'pointerup', this.onPointerUp );
		this.clear();

	}

	private readonly onPointerDown = ( event: PointerEvent ) => {

		if ( ! this.armed || event.button !== 0 || this.busy ) {

			return;

		}

		if ( ( event.target as HTMLElement | null )?.closest?.( '.lil-gui' ) ) {

			return;

		}

		this.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };

	};

	private readonly onPointerUp = ( event: PointerEvent ) => {

		const start = this.pointer;
		this.pointer = null;
		if ( ! start || start.id !== event.pointerId || ! this.armed || this.busy ) {

			return;

		}

		if ( document.pointerLockElement ) {

			return;

		}

		if ( Math.hypot( event.clientX - start.x, event.clientY - start.y ) > 6 ) {

			return;

		}

		this.pickAt( event.clientX, event.clientY );

	};

	private pickAt( clientX: number, clientY: number ) {

		const splat = this.getSplat();
		const camera = this.getCamera();
		if ( ! splat || ! camera || ! this.getScene() ) {

			this.status = { key: 'pick.notReady' };
			this.gui?.setPickStatus( this.status );
			return;

		}

		this.busy = true;
		this.status = { key: 'pick.busy' };
		this.gui?.setPickStatus( this.status );
		window.setTimeout( () => {

			this.busy = false;
			if ( this.disposed || ! this.armed ) {

				return;

			}

			const liveSplat = this.getSplat();
			const liveCamera = this.getCamera();
			if ( ! liveSplat || ! liveCamera ) {

				return;

			}

			const rect = this.stage.getBoundingClientRect();
			const ndc = new THREE.Vector2(
				( ( clientX - rect.left ) / rect.width ) * 2 - 1,
				-( ( clientY - rect.top ) / rect.height ) * 2 + 1
			);
			this.raycaster.setFromCamera( ndc, liveCamera );
			const hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
			liveSplat.raycast( this.raycaster, hits );
			if ( hits.length === 0 ) {

				this.status = { key: 'pick.miss' };
				this.gui?.setPickStatus( this.status );
				return;

			}

			hits.sort( ( a, b ) => a.distance - b.distance );
			const point = hits[ 0 ].point.clone();
			this.points.push( point );
			this.addMarker( point );
			this.status = this.formatPoint( point );
			this.gui?.setPickStatus( this.status );
			this.gui?.setPickLines( this.lines() );

		}, 0 );

	}

	private addMarker( point: THREE.Vector3 ) {

		const scene = this.getScene();
		if ( ! scene || ! this.isDebugEnabled() ) {

			return;

		}

		if ( ! this.markers ) {

			this.markers = new THREE.Group();
			this.markers.name = 'pick-markers';
			scene.add( this.markers );
			this.markerGeometry = new THREE.SphereGeometry(
				SCENE_EFFECT_CONFIG.overview.pickMarkerRadius,
				14,
				10
			);
			this.markerMaterial = new THREE.MeshBasicMaterial( { color: 0xffe08a } );

		}

		const marker = new THREE.Mesh( this.markerGeometry, this.markerMaterial );
		marker.position.copy( point );
		this.markers.add( marker );

	}

	private formatPoint( point: THREE.Vector3 ) {

		return `${ point.x.toFixed( 3 ) }, ${ point.y.toFixed( 3 ) }, ${ point.z.toFixed( 3 ) }`;

	}

}
