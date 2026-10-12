# 第三方许可声明

## 降雨、飞溅与积水（GPL-3.0）

来源：[Faraz-Portfolio/demo-2023-rain-puddle，提交 257066b](https://github.com/Faraz-Portfolio/demo-2023-rain-puddle/tree/257066b63d08b227df8f982377e60f91752ddc81)。完整协议见 [GPL-3.0 许可证](third_party/Faraz-rain-puddle-GPL-3.0.txt)。

| 本项目文件 | 上游文件 |
| --- | --- |
| `src/scene/weather/puddleMaterial.ts` | `src/Floor/PuddleMaterial.tsx` |
| `src/scene/weather/RainEffect.ts` | `src/Rain/Drops.tsx`、`src/Rain/Splashes/index.tsx`、`src/Rain/Splashes/useSplashPositions.ts`、`src/useMakeRain.ts` |
| `public/textures/weather/Splash.png` | `public/Splash.png` |

修改说明（2026-10-11）：将 React 组件与 Hooks 适配为 Three.js 更新循环，调整场景采样与材质参数，并将积水环境反射改为平面反射。

## MIT 组件

| 来源 | 使用位置 |
| --- | --- |
| [Three.js / Reflector](https://github.com/mrdoob/three.js) | `src/scene/weather/planarReflection.ts` 的镜像相机与斜裁剪算法 |
| [three-custom-shader-material](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial) 6.3.7 | 积水材质依赖 |
| [gl-noise](https://github.com/FarazzShaikh/glNoise) 1.6.1 | 积水噪声依赖 |

以上组件的原始版权声明与完整协议见 [MIT 许可证](third_party/MIT-licenses.txt)。
