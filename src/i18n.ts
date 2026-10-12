// 提供界面与调试面板共用的中英文词条、浏览器语言识别和更新通知。

const zh = {
	'ui.scene': '湘学联 3DGS 天气场景',
	'ui.settings': '环境设置',
	'ui.openSettings': '打开环境设置',
	'ui.close': '关闭',
	'ui.closeSettings': '关闭环境设置',
	'ui.walkMode': '漫游模式',
	'ui.viewMode': '环视模式',
	'ui.toWalk': '切换到漫游模式',
	'ui.toView': '切换到环视模式',
	'ui.controls': '漫游按键说明',
	'ui.moveKeys': 'W A S D 移动',
	'ui.driveKeys': 'W A S D 驾驶',
	'ui.move': '移动',
	'ui.look': '视角',
	'ui.sprint': '加速',
	'ui.jump': '跳跃',
	'ui.enterVehicle': '上车',
	'ui.switchView': '切换视角',
	'ui.fly': '飞行',
	'ui.drive': '驾驶',
	'ui.drift': '漂移',
	'ui.brake': '刹车',
	'ui.exitVehicle': '下车',
	'ui.reset': '复位',
	'ui.rain': '降雨',
	'ui.snow': '降雪',
	'ui.sky': '天空',
	'ui.lighting': '光照',
	'ui.time': '时间',
	'ui.fps': '当前帧率',
	'ui.loading': '加载场景…',
	'ui.loadFailed': '场景加载失败',
	'ui.progress': '场景加载进度',
	'ui.unknownError': '未知错误',
	'gui.title': '调试',
	'gui.snowCover': '积雪',
	'gui.collider': '碰撞网格（Mesh）',
	'gui.player': '玩家',
	'gui.pick': '点云拾取',
	'gui.floodlights': '照射灯',
	'gui.puddles': '积水',
	'gui.fallSpeed': '下落速度',
	'gui.wind': '风向 {axis}',
	'gui.coverage': '覆盖',
	'gui.patchFrequency': '斑块频率',
	'gui.edgeSoftness': '边缘柔和',
	'gui.thickness': '厚度',
	'gui.upwardThreshold': '朝上阈值',
	'gui.bumpFrequency': '起伏频率',
	'gui.bumpStrength': '起伏强度',
	'gui.roughness': '粗糙度',
	'gui.footprintStrength': '脚印强度',
	'gui.showCollider': '显示碰撞网格',
	'gui.meshOcclusion': 'Mesh 深度遮挡',
	'gui.showCapsule': '显示胶囊体',
	'gui.pickMode': '拾取模式',
	'gui.latest': '最近',
	'gui.copyAll': '复制全部',
	'gui.clear': '清空',
	'gui.picked': '已拾取',
	'gui.coordinates': '坐标',
	'gui.status': '状态',
	'gui.lightOcclusion': '碰撞遮挡',
	'gui.lightLimit': '已满 {count} 盏',
	'gui.addFromPick': '用拾取点添加',
	'gui.light': '灯 {index}',
	'gui.direction': '方向 {axis}',
	'gui.color': '颜色',
	'gui.width': '宽度',
	'gui.height': '高度',
	'gui.range': '距离',
	'gui.intensity': '强度',
	'gui.spread': '张角',
	'gui.softness': '软边',
	'gui.showVolume': '显示范围',
	'gui.remove': '删除',
	'gui.show': '显示',
	'gui.showGrid': '显示网格',
	'gui.waterOpacity': '水层强度',
	'gui.puddleCoverage': '积水覆盖',
	'gui.puddleSize': '水块尺寸',
	'gui.rippleStrength': '涟漪强度',
	'gui.waterRoughness': '水面粗糙度',
	'gui.reflectionBlur': '反射模糊',
	'gui.patch': '贴片 {index}',
	'gui.transformEnabled': '位姿控制',
	'gui.transformMode': '控制模式',
	'gui.translate': '平移',
	'gui.rotate': '旋转',
	'gui.scale': '缩放',
	'gui.position': '位置 {axis}',
	'gui.length': '长度',
	'gui.rotation': '旋转 {axis}°',
	'pick.off': '关闭',
	'pick.ready': '点击场景拾取',
	'pick.empty': '暂无',
	'pick.noCoordinates': '没有坐标',
	'pick.copied': '已复制',
	'pick.notReady': '点云未就绪',
	'pick.busy': '计算中…',
	'pick.miss': '未命中点云',
	'pick.lightLimit': '照射灯已满 {count} 盏',
	'flood.night': '夜晚开启',
	'flood.day': '白天关闭'
};

/** 所有可翻译的界面词条键。 */
export type TranslationKey = keyof typeof zh;
/** 支持的界面语言；中文包含各地区的浏览器中文设置。 */
export type Language = 'zh-CN' | 'en';
/** 词条中的编号、数量和坐标轴占位参数。 */
export type TranslationValues = Readonly<Record<string, string | number>>;
/** 与语言无关的状态描述，字符串用于原样显示坐标等数据。 */
export type LocalizedText = string | { key: TranslationKey; values?: TranslationValues };

const en: Record<TranslationKey, string> = {
	'ui.scene': 'Xiangxuelian 3DGS weather scene',
	'ui.settings': 'Environment Settings',
	'ui.openSettings': 'Open environment settings',
	'ui.close': 'Close',
	'ui.closeSettings': 'Close environment settings',
	'ui.walkMode': 'Explore Mode',
	'ui.viewMode': 'Orbit Mode',
	'ui.toWalk': 'Switch to explore mode',
	'ui.toView': 'Switch to orbit mode',
	'ui.controls': 'Exploration controls',
	'ui.moveKeys': 'W A S D to move',
	'ui.driveKeys': 'W A S D to drive',
	'ui.move': 'Move',
	'ui.look': 'Look',
	'ui.sprint': 'Sprint',
	'ui.jump': 'Jump',
	'ui.enterVehicle': 'Enter vehicle',
	'ui.switchView': 'Switch view',
	'ui.fly': 'Fly',
	'ui.drive': 'Drive',
	'ui.drift': 'Drift',
	'ui.brake': 'Brake',
	'ui.exitVehicle': 'Exit vehicle',
	'ui.reset': 'Reset',
	'ui.rain': 'Rain',
	'ui.snow': 'Snow',
	'ui.sky': 'Sky',
	'ui.lighting': 'Lighting',
	'ui.time': 'Time',
	'ui.fps': 'Current frame rate',
	'ui.loading': 'Loading scene…',
	'ui.loadFailed': 'Scene loading failed',
	'ui.progress': 'Scene loading progress',
	'ui.unknownError': 'Unknown error',
	'gui.title': 'Debug',
	'gui.snowCover': 'Snow Cover',
	'gui.collider': 'Collision Mesh',
	'gui.player': 'Player',
	'gui.pick': '3DGS Picking',
	'gui.floodlights': 'Floodlights',
	'gui.puddles': 'Puddles',
	'gui.fallSpeed': 'Fall speed',
	'gui.wind': 'Wind {axis}',
	'gui.coverage': 'Coverage',
	'gui.patchFrequency': 'Patch frequency',
	'gui.edgeSoftness': 'Edge softness',
	'gui.thickness': 'Thickness',
	'gui.upwardThreshold': 'Upward threshold',
	'gui.bumpFrequency': 'Bump frequency',
	'gui.bumpStrength': 'Bump strength',
	'gui.roughness': 'Roughness',
	'gui.footprintStrength': 'Footprint strength',
	'gui.showCollider': 'Show collision mesh',
	'gui.meshOcclusion': 'Mesh depth occlusion',
	'gui.showCapsule': 'Show capsule',
	'gui.pickMode': 'Picking mode',
	'gui.latest': 'Latest',
	'gui.copyAll': 'Copy all',
	'gui.clear': 'Clear',
	'gui.picked': 'Picked Points',
	'gui.coordinates': 'Coordinates',
	'gui.status': 'Status',
	'gui.lightOcclusion': 'Collider occlusion',
	'gui.lightLimit': 'Limit: {count} lights',
	'gui.addFromPick': 'Add from picked point',
	'gui.light': 'Light {index}',
	'gui.direction': 'Direction {axis}',
	'gui.color': 'Color',
	'gui.width': 'Width',
	'gui.height': 'Height',
	'gui.range': 'Range',
	'gui.intensity': 'Intensity',
	'gui.spread': 'Spread',
	'gui.softness': 'Softness',
	'gui.showVolume': 'Show volume',
	'gui.remove': 'Remove',
	'gui.show': 'Show',
	'gui.showGrid': 'Show grid',
	'gui.waterOpacity': 'Water opacity',
	'gui.puddleCoverage': 'Puddle coverage',
	'gui.puddleSize': 'Puddle size',
	'gui.rippleStrength': 'Ripple strength',
	'gui.waterRoughness': 'Water roughness',
	'gui.reflectionBlur': 'Reflection blur',
	'gui.patch': 'Patch {index}',
	'gui.transformEnabled': 'Transform gizmo',
	'gui.transformMode': 'Transform mode',
	'gui.translate': 'Translate',
	'gui.rotate': 'Rotate',
	'gui.scale': 'Scale',
	'gui.position': 'Position {axis}',
	'gui.length': 'Length',
	'gui.rotation': 'Rotation {axis}°',
	'pick.off': 'Off',
	'pick.ready': 'Click scene to pick',
	'pick.empty': 'None',
	'pick.noCoordinates': 'No coordinates',
	'pick.copied': 'Copied',
	'pick.notReady': '3DGS not ready',
	'pick.busy': 'Computing…',
	'pick.miss': 'No 3DGS hit',
	'pick.lightLimit': 'Floodlight limit reached ({count})',
	'flood.night': 'On at night',
	'flood.day': 'Off during daytime'
};

const listeners = new Set<() => void>();

/** 按浏览器首选语言选择中文，其他语言统一使用英文。 */
const browserLanguage = (): Language => {
	const preferred = navigator.languages?.[ 0 ] ?? navigator.language;
	return /^zh(?:-|$)/i.test( preferred ) ? 'zh-CN' : 'en';
};

let language = browserLanguage();

/** 返回当前界面语言。 */
export const getLanguage = () => language;

// 浏览器语言变化时同步主界面与调试面板。
window.addEventListener( 'languagechange', () => {
	const next = browserLanguage();
	if ( language === next ) return;
	language = next;
	for ( const listener of listeners ) listener();
} );

/** 订阅语言切换，返回用于释放订阅的函数。 */
export const onLanguageChange = ( listener: () => void ) => {
	listeners.add( listener );
	return () => { listeners.delete( listener ); };
};

/** 按当前语言读取词条并替换编号、数量等占位参数。 */
export const t = ( key: TranslationKey, values: TranslationValues = {} ): string => {
	const text = language === 'zh-CN' ? zh[ key ] : en[ key ];
	return text.replace( /\{(\w+)\}/g, ( token, name: string ) => String( values[ name ] ?? token ) );
};

/** 将状态词条翻译为文本，保留坐标及外部数据的原始格式。 */
export const translateText = ( text: LocalizedText ) => typeof text === 'string' ? text : t( text.key, text.values );

/** 翻译标记元素的文本、悬浮提示和辅助阅读标签。 */
export const translateDocument = () => {
	document.documentElement.lang = language;
	const attributes = [ [ 'data-i18n', null ], [ 'data-i18n-title', 'title' ], [ 'data-i18n-aria-label', 'aria-label' ] ] as const;
	for ( const [ marker, attribute ] of attributes ) {
		for ( const element of document.querySelectorAll<HTMLElement>( `[${ marker }]` ) ) {
			const key = element.getAttribute( marker ) as TranslationKey;
			if ( ! Object.hasOwn( zh, key ) ) continue;
			if ( attribute ) element.setAttribute( attribute, t( key ) );
			else element.textContent = t( key );
		}
	}
};
