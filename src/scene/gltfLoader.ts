// 提供共享的模型加载器，统一配置 Draco 解码路径。

import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let sharedLoader: GLTFLoader | undefined;

/** 带 Draco 解压的 GLTF/GLB 加载器（碰撞体、人物等复用同一实例）。 */
export const createGltfLoader = () => {

	if ( sharedLoader ) {

		return sharedLoader;

	}

	const dracoLoader = new DRACOLoader();
	dracoLoader.setDecoderPath( `${ import.meta.env.BASE_URL }draco/` );

	sharedLoader = new GLTFLoader();
	sharedLoader.setDRACOLoader( dracoLoader );
	return sharedLoader;

};
