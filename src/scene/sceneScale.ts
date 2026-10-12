// 将人物参考尺度下的长度、面密度和纹理密度换算为场景尺度。

/**
 * 天气世界尺度：与人物模型缩放一致。
 * 雨 / 雪 / 积水 / 光照阴影等世界长度量按「人物尺度 = 1」编写，再乘 PLAYER_MODEL_SCALE。
 * 人物控制器与车辆的尺度由插件内部处理。
 */
export const PLAYER_MODEL_SCALE = 0.01;

/** 将参考尺度下的世界长度换算为场景长度。 */
export const worldLen = ( unit: number ) => unit * PLAYER_MODEL_SCALE;

/** 将参考尺度下的面密度换算为场景面密度，即除以人物缩放系数的平方。 */
export const worldAreaDensity = ( unitDensity: number ) => (
	unitDensity / ( PLAYER_MODEL_SCALE * PLAYER_MODEL_SCALE )
);

/** 将参考尺度下每米纹素数换算为场景纹理密度，即除以人物缩放系数。 */
export const worldTexelsPerMeter = ( unitTexels: number ) => unitTexels / PLAYER_MODEL_SCALE;
