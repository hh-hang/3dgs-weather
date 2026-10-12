// 构建场景调试面板，将控件变化传递给对应子系统。

import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { onLanguageChange, t, translateText, type LocalizedText, type TranslationKey, type TranslationValues } from '../../i18n';
import type { ColliderSnowAccumulation } from '../weather/colliderSnowAccumulation';
import type { RainEffect } from '../weather/RainEffect';
import { PUDDLE_PATCH_PARAMETER_RANGES, type PuddlePatchSystem } from '../weather/puddlePatchSystem';
import { FLOOD_LIGHT_LIMIT, type SceneFloodLight } from '../lighting/sceneFloodLights';

/** 点云拾取面板的状态与操作回调。 */
export type ScenePickControls = {
	/** 是否启用点击拾取。 */
	armed: boolean;
	/** 当前拾取状态文本。 */
	status: LocalizedText;
	/** 已拾取坐标的显示文本。 */
	lines: string[];
	/** 切换拾取状态时调用。 */
	onArmedChange: ( armed: boolean ) => void;
	/** 清空拾取坐标时调用。 */
	onClear: () => void;
	/** 复制全部拾取坐标时调用。 */
	onCopy: () => void;
};

/** 照射灯面板的状态与操作回调。 */
export type SceneFloodControls = {
	/** 当前场景的照射灯列表。 */
	lights: SceneFloodLight[];
	/** 是否处于夜间照明时段。 */
	night: boolean;
	/** 是否启用碰撞体灯光遮挡。 */
	occlusion: boolean;
	/** 切换灯光遮挡时调用。 */
	onOcclusionChange: ( enabled: boolean ) => void;
	/** 添加照射灯时调用。 */
	onAdd: () => void;
	/** 删除指定索引的照射灯时调用。 */
	onRemove: ( index: number ) => void;
	/** 修改灯光参数后调用。 */
	onChange: () => void;
};

/** 碰撞网格面板的显示与遮挡设置。 */
export type SceneColliderControls = {
	/** 碰撞网格线框是否可见。 */
	visible: boolean;
	/** 是否启用网格深度遮挡。 */
	meshOcclusion: boolean;
	/** 切换线框显示时调用。 */
	onVisibleChange: ( visible: boolean ) => void;
	/** 切换网格遮挡时调用。 */
	onMeshOcclusionChange: ( enabled: boolean ) => void;
};

/** 人物调试面板的胶囊体显示设置。 */
export type ScenePlayerControls = {
	/** 人物胶囊体是否可见。 */
	capsuleVisible: boolean;
	/** 切换胶囊体显示时调用。 */
	onCapsuleVisibleChange: ( visible: boolean ) => void;
};

/** 积水位姿操作模式：平移、旋转或缩放。 */
export type ScenePuddleTransformMode = 'translate' | 'rotate' | 'scale';

/** 积水位姿面板的当前选择与操作回调。 */
export type ScenePuddleTransformControls = {
	/** 当前操作的贴片索引；null 表示未选中。 */
	enabledPatchIndex: number | null;
	/** 当前位姿操作模式。 */
	mode: ScenePuddleTransformMode;
	/** 切换指定贴片的操作状态时调用。 */
	onEnabledChange: ( index: number, enabled: boolean ) => void;
	/** 切换位姿操作模式时调用。 */
	onModeChange: ( mode: ScenePuddleTransformMode ) => void;
};

/** 调试面板绑定的场景子系统与回调。 */
export type SceneDebugTargets = {
	/** 积水贴片系统。 */
	puddlePatchSystem?: PuddlePatchSystem | null;
	/** 积水位姿控件的状态与回调。 */
	puddleTransform?: ScenePuddleTransformControls | null;
	/** 积水可见性变化后调用，用于同步碰撞深度层。 */
	onPuddleVisibilityChange?: () => void;
	/** 点云拾取控件。 */
	pick?: ScenePickControls | null;
	/** 照射灯控件。 */
	flood?: SceneFloodControls | null;
	/** 碰撞网格控件。 */
	collider?: SceneColliderControls | null;
	/** 人物调试控件。 */
	player?: ScenePlayerControls | null;
	/** 地面积雪覆盖层。 */
	groundSnow?: ColliderSnowAccumulation | null;
	/** 降雨与飞溅效果。 */
	rain?: RainEffect | null;
};

/** 场景调试面板，提供碰撞网格、点云拾取、照射灯与积水控制。 */
export class SceneDebugGui {

	private readonly gui: GUI;
	private puddleFolder: GUI | undefined;
	private pickFolder: GUI | undefined;
	private floodFolder: GUI | undefined;
	private colliderFolder: GUI | undefined;
	private playerFolder: GUI | undefined;
	private groundSnowFolder: GUI | undefined;
	private rainFolder: GUI | undefined;
	private pickList: GUI | undefined;
	private readonly pickState = { armed: false, status: '' };
	private pickStatus: LocalizedText = { key: 'pick.off' };
	private readonly translations = new WeakMap<object, () => void>();
	private readonly valueTranslations = new WeakMap<object, () => void>();
	private readonly unsubscribeLanguage: () => void;
	private statusController: { updateDisplay: () => void } | undefined;
	private armedController: { updateDisplay: () => void } | undefined;

	constructor( parent?: HTMLElement ) {

		this.gui = new GUI( {
			title: t( 'gui.title' ),
			width: 300,
			container: parent
		} );
		const style = this.gui.domElement.style;
		style.position = 'fixed';
		style.left = '12px';
		style.bottom = '12px';
		style.top = 'auto';
		style.right = 'auto';
		style.zIndex = '40';
		style.maxWidth = 'calc(100vw - 24px)';
		this.unsubscribeLanguage = onLanguageChange( this.refreshLanguage );

	}

	/** 按当前目标重建控件。 */
	bind( targets: SceneDebugTargets ) {

		this.clearFolders();

		if ( targets.collider ) {

			this.bindCollider( targets.collider );

		}

		if ( targets.player ) {

			this.bindPlayer( targets.player );

		}

		if ( targets.pick ) {

			this.bindPick( targets.pick );

		}

		if ( targets.flood ) {

			this.bindFlood( targets.flood );

		}

		if ( targets.groundSnow ) {

			this.bindGroundSnow( targets.groundSnow );

		}

		if ( targets.rain ) {

			this.bindRain( targets.rain );

		}

		if ( targets.puddlePatchSystem ) {

			this.bindPuddle(
				targets.puddlePatchSystem,
				targets.puddleTransform ?? null,
				targets.onPuddleVisibilityChange
			);

		}

	}

	/** 同步拾取开关并刷新控件显示。 */
	setPickArmed( armed: boolean ) {

		this.pickState.armed = armed;
		this.armedController?.updateDisplay();

	}

	/** 同步拾取状态文本并刷新显示。 */
	setPickStatus( status: LocalizedText ) {

		this.pickStatus = status;
		this.pickState.status = translateText( status );
		this.statusController?.updateDisplay();

	}

	/** 按坐标文本列表重建拾取记录控件。 */
	setPickLines( lines: string[] ) {

		this.rebuildPickList( lines );

	}

	/** 销毁调试面板及其全部控件。 */
	dispose() {

		this.unsubscribeLanguage();
		this.gui.destroy();

	}

	// 原位翻译现有控件，保留参数值、控件引用与文件夹展开状态。
	private readonly refreshLanguage = () => {
		this.gui.title( t( 'gui.title' ) );
		for ( const folder of this.gui.foldersRecursive() ) this.translations.get( folder )?.();
		for ( const controller of this.gui.controllersRecursive() ) {
			this.translations.get( controller )?.();
			this.valueTranslations.get( controller )?.();
		}
		this.setPickStatus( this.pickStatus );
	};

	private folder( parent: GUI, key: TranslationKey, values: TranslationValues = {} ) {
		const folder = parent.addFolder( t( key, values ) );
		this.translations.set( folder, () => folder.title( t( key, values ) ) );
		return folder;
	}

	private label<T extends { name: ( name: string ) => unknown }>( controller: T, key: TranslationKey, values: TranslationValues = {} ) {
		const update = () => { controller.name( t( key, values ) ); };
		this.translations.set( controller, update );
		update();
		return controller;
	}

	private localizedValue<T extends { updateDisplay: () => unknown }>( controller: T, update: () => void ) {
		const refresh = () => {
			update();
			controller.updateDisplay();
		};
		this.valueTranslations.set( controller, refresh );
		refresh();
		return controller;
	}

	// 原位翻译下拉选项及当前显示值，保持控件实例、选中值与事件回调。
	private localizedOptions<T extends { domElement: HTMLElement; updateDisplay: () => unknown }>( controller: T, keys: readonly TranslationKey[] ) {
		const select = controller.domElement.querySelector( 'select' );
		const display = controller.domElement.querySelector<HTMLElement>( '.display' );
		const updateDisplay = controller.updateDisplay.bind( controller );
		controller.updateDisplay = () => {
			updateDisplay();
			if ( select ) {
				keys.forEach( ( key, index ) => {
					if ( select.options[ index ] ) select.options[ index ].textContent = t( key );
				} );
				const selected = keys[ select.selectedIndex ];
				if ( display && selected ) display.textContent = t( selected );
			}
			return controller;
		};
		this.valueTranslations.set( controller, () => { controller.updateDisplay(); } );
		controller.updateDisplay();
		return controller;
	}

	private clearFolders() {

		this.puddleFolder?.destroy();
		this.puddleFolder = undefined;
		this.pickList?.destroy();
		this.pickList = undefined;
		this.pickFolder?.destroy();
		this.pickFolder = undefined;
		this.floodFolder?.destroy();
		this.floodFolder = undefined;
		this.colliderFolder?.destroy();
		this.colliderFolder = undefined;
		this.playerFolder?.destroy();
		this.playerFolder = undefined;
		this.groundSnowFolder?.destroy();
		this.groundSnowFolder = undefined;
		this.rainFolder?.destroy();
		this.rainFolder = undefined;
		this.statusController = undefined;
		this.armedController = undefined;

	}

	private bindRain( rain: RainEffect ) {

		const folder = this.folder( this.gui, 'ui.rain' );
		this.rainFolder = folder;
		const wind = rain.getWind();
		const state = {
			fallSpeed: rain.getFallSpeed(),
			windX: wind.x,
			windZ: wind.y
		};
		this.label( folder.add( state, 'fallSpeed', 0.5, 6, 0.05 ), 'gui.fallSpeed' ).onChange( ( v: number ) => {
			rain.setFallSpeed( v );
		} );
		this.label( folder.add( state, 'windX', - 3, 3, 0.05 ), 'gui.wind', { axis: 'X' } ).onChange( ( v: number ) => {
			rain.setWind( v, state.windZ );
		} );
		this.label( folder.add( state, 'windZ', - 3, 3, 0.05 ), 'gui.wind', { axis: 'Z' } ).onChange( ( v: number ) => {
			rain.setWind( state.windX, v );
		} );
		folder.open();

	}

	private bindGroundSnow( snow: ColliderSnowAccumulation ) {

		const folder = this.folder( this.gui, 'gui.snowCover' );
		this.groundSnowFolder = folder;
		const p = snow.getParams();
		const state = {
			coverage: p.coverage,
			scale: p.scale,
			edge: p.edge,
			depth: p.depth,
			bumpScale: p.bumpScale,
			bumpStrength: p.bumpStrength,
			roughness: p.roughness,
			flatThreshold: p.flatThreshold,
			deformStrength: p.deformStrength
		};
		this.label( folder.add( state, 'coverage', 0, 1, 0.01 ), 'gui.coverage' ).onChange( ( v: number ) => snow.setCoverage( v ) );
		this.label( folder.add( state, 'scale', 0.001, 0.2, 0.001 ), 'gui.patchFrequency' ).onChange( ( v: number ) => snow.setScale( v ) );
		this.label( folder.add( state, 'edge', 0, 0.4, 0.01 ), 'gui.edgeSoftness' ).onChange( ( v: number ) => snow.setEdge( v ) );
		this.label( folder.add( state, 'depth', 0, 0.5, 0.005 ), 'gui.thickness' ).onChange( ( v: number ) => snow.setDepth( v ) );
		this.label( folder.add( state, 'flatThreshold', 0, 0.99, 0.01 ), 'gui.upwardThreshold' ).onChange( ( v: number ) => snow.setFlatThreshold( v ) );
		this.label( folder.add( state, 'bumpScale', 0.01, 1, 0.01 ), 'gui.bumpFrequency' ).onChange( ( v: number ) => snow.setBumpScale( v ) );
		this.label( folder.add( state, 'bumpStrength', 0, 1, 0.01 ), 'gui.bumpStrength' ).onChange( ( v: number ) => snow.setBumpStrength( v ) );
		this.label( folder.add( state, 'roughness', 0, 1, 0.01 ), 'gui.roughness' ).onChange( ( v: number ) => snow.setRoughness( v ) );
		this.label( folder.add( state, 'deformStrength', 0, 1, 0.01 ), 'gui.footprintStrength' ).onChange( ( v: number ) => snow.setDeformStrength( v ) );
		folder.open();

	}

	private bindCollider( collider: SceneColliderControls ) {

		const folder = this.folder( this.gui, 'gui.collider' );
		this.colliderFolder = folder;
		const state = {
			visible: collider.visible,
			meshOcclusion: collider.meshOcclusion
		};
		this.label( folder.add( state, 'visible' ), 'gui.showCollider' ).onChange( ( visible: boolean ) => {

			collider.onVisibleChange( visible );

		} );
		this.label( folder.add( state, 'meshOcclusion' ), 'gui.meshOcclusion' ).onChange( ( enabled: boolean ) => {

			collider.onMeshOcclusionChange( enabled );

		} );
		folder.open();

	}

	private bindPlayer( player: ScenePlayerControls ) {

		const folder = this.folder( this.gui, 'gui.player' );
		this.playerFolder = folder;
		const state = { capsuleVisible: player.capsuleVisible };
		this.label( folder.add( state, 'capsuleVisible' ), 'gui.showCapsule' ).onChange( ( visible: boolean ) => {

			player.onCapsuleVisibleChange( visible );

		} );
		folder.open();

	}

	private bindPick( pick: ScenePickControls ) {

		const folder = this.folder( this.gui, 'gui.pick' );
		this.pickFolder = folder;
		this.pickState.armed = pick.armed;
		this.setPickStatus( pick.status );
		this.armedController = this.label( folder.add( this.pickState, 'armed' ), 'gui.pickMode' ).onChange( ( value: boolean ) => {

			pick.onArmedChange( value );

		} );
		this.statusController = this.label( folder.add( this.pickState, 'status' ), 'gui.latest' ).disable();
		this.label( folder.add( { copy: () => pick.onCopy() }, 'copy' ), 'gui.copyAll' );
		this.label( folder.add( { clear: () => pick.onClear() }, 'clear' ), 'gui.clear' );
		this.rebuildPickList( pick.lines );
		folder.open();

	}

	private rebuildPickList( lines: string[] ) {

		this.pickList?.destroy();
		if ( ! this.pickFolder ) {

			return;

		}

		const list = this.folder( this.pickFolder, 'gui.picked' );
		this.pickList = list;

		if ( lines.length === 0 ) {

			const empty = { value: '' };
			this.localizedValue( this.label( list.add( empty, 'value' ), 'gui.coordinates' ), () => {
				empty.value = t( 'pick.empty' );
			} ).disable();

		} else {

			lines.forEach( ( line, index ) => {

				const row = { value: line };
				list.add( row, 'value' ).name( String( index + 1 ) ).disable();

			} );

		}

		list.open();

	}

	private bindFlood( flood: SceneFloodControls ) {

		const folder = this.folder( this.gui, 'gui.floodlights' );
		this.floodFolder = folder;
		const status = { value: '' };
		this.localizedValue( this.label( folder.add( status, 'value' ), 'gui.status' ), () => {
			status.value = t( flood.night ? 'flood.night' : 'flood.day' );
		} ).disable();
		const occlusion = { enabled: flood.occlusion };
		this.label( folder.add( occlusion, 'enabled' ), 'gui.lightOcclusion' ).onChange( ( value: boolean ) => {

			flood.onOcclusionChange( value );

		} );
		this.label( folder.add( { add: () => flood.onAdd() }, 'add' ), flood.lights.length >= FLOOD_LIGHT_LIMIT ? 'gui.lightLimit' : 'gui.addFromPick', { count: FLOOD_LIGHT_LIMIT } );

		flood.lights.forEach( ( light, index ) => {

			const group = this.folder( folder, 'gui.light', { index: index + 1 } );
			const state = {
				x: light.position.x,
				y: light.position.y,
				z: light.position.z,
				dx: light.direction.x,
				dy: light.direction.y,
				dz: light.direction.z,
				color: `#${ light.color.getHexString() }`,
				width: light.width,
				height: light.height,
				range: light.range,
				intensity: light.intensity,
				spread: light.spread,
				softness: light.softness,
				showVolume: light.showVolume
			};
			const write = () => {

				light.position.set( state.x, state.y, state.z );
				light.direction.set( state.dx, state.dy, state.dz );
				light.color.set( state.color );
				light.width = state.width;
				light.height = state.height;
				light.range = state.range;
				light.intensity = state.intensity;
				light.spread = state.spread;
				light.softness = state.softness;
				light.showVolume = state.showVolume;
				flood.onChange();

			};
			group.add( state, 'x', - 200, 200, 0.01 ).name( 'X' ).onChange( write );
			group.add( state, 'y', - 200, 200, 0.01 ).name( 'Y' ).onChange( write );
			group.add( state, 'z', - 200, 200, 0.01 ).name( 'Z' ).onChange( write );
			this.label( group.add( state, 'dx', - 1, 1, 0.01 ), 'gui.direction', { axis: 'X' } ).onChange( write );
			this.label( group.add( state, 'dy', - 1, 1, 0.01 ), 'gui.direction', { axis: 'Y' } ).onChange( write );
			this.label( group.add( state, 'dz', - 1, 1, 0.01 ), 'gui.direction', { axis: 'Z' } ).onChange( write );
			this.label( group.addColor( state, 'color' ), 'gui.color' ).onChange( write );
			this.label( group.add( state, 'width', 0.1, 40, 0.1 ), 'gui.width' ).onChange( write );
			this.label( group.add( state, 'height', 0.1, 40, 0.1 ), 'gui.height' ).onChange( write );
			this.label( group.add( state, 'range', 0.5, 80, 0.1 ), 'gui.range' ).onChange( write );
			this.label( group.add( state, 'intensity', 0, 4, 0.01 ), 'gui.intensity' ).onChange( write );
			this.label( group.add( state, 'spread', 0, 0.8, 0.01 ), 'gui.spread' ).onChange( write );
			this.label( group.add( state, 'softness', 0.02, 0.9, 0.01 ), 'gui.softness' ).onChange( write );
			this.label( group.add( state, 'showVolume' ), 'gui.showVolume' ).onChange( write );
			this.label( group.add( { remove: () => flood.onRemove( index ) }, 'remove' ), 'gui.remove' );

		} );

		folder.open();

	}

	private bindPuddle(
		puddle: PuddlePatchSystem,
		transform: ScenePuddleTransformControls | null,
		onVisibilityChange?: () => void
	) {

		const folder = this.folder( this.gui, 'gui.puddles' );
		this.puddleFolder = folder;

		const state = {
			enabled: puddle.getEnabled(),
			showGrid: puddle.getGridVisible(),
			opacity: puddle.getOpacity(),
			coverage: puddle.getCoverage(),
			puddleScale: puddle.getPuddleScale(),
			edgeSoftness: puddle.getEdgeSoftness(),
			rippleStrength: puddle.getRippleStrength(),
			roughness: puddle.getRoughness(),
			reflectionBlur: puddle.getReflectionBlur()
		};

		this.label( folder.add( state, 'enabled' ), 'gui.show' ).onChange( ( value: boolean ) => {

			puddle.setEnabled( value );
			onVisibilityChange?.();

		} );
		this.label( folder.add( state, 'showGrid' ), 'gui.showGrid' ).onChange( ( value: boolean ) => {

			puddle.setGridVisible( value );

		} );
		const ranges = PUDDLE_PATCH_PARAMETER_RANGES;
		this.label( folder.add( state, 'opacity', 0, 1, 0.01 ), 'gui.waterOpacity' ).onChange( ( value: number ) => {

			puddle.setOpacity( value );
			onVisibilityChange?.();

		} );
		this.label( folder.add( state, 'coverage', 0, 1, 0.01 ), 'gui.puddleCoverage' ).onChange( ( value: number ) => {

			puddle.setCoverage( value );
			onVisibilityChange?.();

		} );
		this.label( folder.add( state, 'puddleScale', 0.05, 3, 0.01 ), 'gui.puddleSize' ).onChange( ( value: number ) => {

			puddle.setPuddleScale( value );

		} );
		this.label( folder.add( state, 'edgeSoftness', 0.001, 0.3, 0.001 ), 'gui.edgeSoftness' ).onChange( ( value: number ) => {

			puddle.setEdgeSoftness( value );

		} );
		this.label( folder.add( state, 'rippleStrength', 0, 0.5, 0.001 ), 'gui.rippleStrength' ).onChange( ( value: number ) => {

			puddle.setRippleStrength( value );

		} );
		this.label( folder.add( state, 'roughness', ranges.roughness.min, ranges.roughness.max, ranges.roughness.step ), 'gui.waterRoughness' ).onChange( ( value: number ) => {

			puddle.setRoughness( value );

		} );
		this.label( folder.add( state, 'reflectionBlur', ranges.reflectionBlur.min, ranges.reflectionBlur.max, ranges.reflectionBlur.step ), 'gui.reflectionBlur' ).onChange( ( value: number ) => {

			puddle.setReflectionBlur( value );

		} );
		puddle.getPatches().forEach( ( patch, index ) => {

			const patchFolder = this.folder( folder, 'gui.patch', { index: index + 1 } );
			const patchState = {
				transformEnabled: transform?.enabledPatchIndex === index,
				transformMode: transform?.mode ?? 'translate' as ScenePuddleTransformMode,
				x: patch.position[ 0 ],
				y: patch.position[ 1 ],
				z: patch.position[ 2 ],
				width: patch.size[ 0 ],
				depth: patch.size[ 1 ],
				rotationX: ( patch.rotation?.[ 0 ] ?? 0 ) * 180 / Math.PI,
				rotationY: ( patch.rotation?.[ 1 ] ?? 0 ) * 180 / Math.PI,
				rotationZ: ( patch.rotation?.[ 2 ] ?? 0 ) * 180 / Math.PI
			};

			if ( transform ) {

				this.label( patchFolder.add( patchState, 'transformEnabled' ), 'gui.transformEnabled' ).onChange( ( enabled: boolean ) => {

					transform.onEnabledChange( index, enabled );

				} );
				this.localizedOptions(
					this.label( patchFolder.add( patchState, 'transformMode', [ 'translate', 'rotate', 'scale' ] ), 'gui.transformMode' ),
					[ 'gui.translate', 'gui.rotate', 'gui.scale' ]
				).onChange( ( mode: ScenePuddleTransformMode ) => {

					transform.onModeChange( mode );

				} );

			}
			const writePosition = () => puddle.setPatchPosition(
				index,
				patchState.x,
				patchState.y,
				patchState.z
			);
			this.label( patchFolder.add( patchState, 'x', - 500, 500, 0.1 ), 'gui.position', { axis: 'X' } ).onChange( writePosition );
			this.label( patchFolder.add( patchState, 'y', - 500, 500, 0.1 ), 'gui.position', { axis: 'Y' } ).onChange( writePosition );
			this.label( patchFolder.add( patchState, 'z', - 500, 500, 0.1 ), 'gui.position', { axis: 'Z' } ).onChange( writePosition );
			this.label( patchFolder.add( patchState, 'width', ranges.patchSize.min, ranges.patchSize.max, ranges.patchSize.step ), 'gui.width' ).onFinishChange( () => {

				puddle.setPatchSize( index, patchState.width, patchState.depth );

			} );
			this.label( patchFolder.add( patchState, 'depth', ranges.patchSize.min, ranges.patchSize.max, ranges.patchSize.step ), 'gui.length' ).onFinishChange( () => {

				puddle.setPatchSize( index, patchState.width, patchState.depth );

			} );
			const writeRotation = () => puddle.setPatchRotation(
				index,
				patchState.rotationX * Math.PI / 180,
				patchState.rotationY * Math.PI / 180,
				patchState.rotationZ * Math.PI / 180
			);
			this.label( patchFolder.add( patchState, 'rotationX', - 180, 180, 0.1 ), 'gui.rotation', { axis: 'X' } ).onChange( writeRotation );
			this.label( patchFolder.add( patchState, 'rotationY', - 180, 180, 0.1 ), 'gui.rotation', { axis: 'Y' } ).onChange( writeRotation );
			this.label( patchFolder.add( patchState, 'rotationZ', - 180, 180, 0.1 ), 'gui.rotation', { axis: 'Z' } ).onChange( writeRotation );

		} );
		folder.open();

	}

}
