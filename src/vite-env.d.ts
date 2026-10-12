/// <reference types="vite/client" />

// 声明构建环境、噪声库入口与着色器文本资源的类型。

declare module 'gl-noise/build/glNoise.m.js' {
	export { patchShaders, Simplex } from 'gl-noise';
}

declare module '*.glsl?raw' {
	/** 以原始文本导入的着色器源码。 */
	const source: string;
	export default source;
}
