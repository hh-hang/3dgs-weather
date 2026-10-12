// 管理积水贴片的位姿、材质、调试网格与场景反射。

import * as THREE from 'three';
import { PlanarReflection } from './planarReflection';
import { createPuddleMaterial, type PuddleMaterial } from './puddleMaterial';
import { createPuddleCoverageUniforms } from './puddleCoverage';
import { worldLen } from '../sceneScale';

const PLANE_SIZE_MIN = worldLen( 5 );
const GRID_SURFACE_OFFSET = worldLen( 2 );

/** 积水调试参数的最小值、最大值和步长。 */
export const PUDDLE_PATCH_PARAMETER_RANGES = {
	/** 贴片宽度和长度的调试范围，世界单位。 */
	patchSize: { min: PLANE_SIZE_MIN, max: worldLen( 50000 ), step: worldLen( 25 ) },
	/** 水面粗糙度的调试范围。 */
	roughness: { min: 0, max: 1, step: 0.001 },
	/** 反射模糊倍率的调试范围。 */
	reflectionBlur: { min: 0, max: 20, step: 0.1 }
} as const;

/** 单块积水贴片的世界空间位姿与尺寸。 */
export type PuddlePatchConfig = {
	/** 水面中心的世界坐标，Y 为最终水面高度。 */
	position: readonly [ number, number, number ];
	/** 水平放置时沿 X/Z 方向的全尺寸，世界单位。 */
	size: readonly [ number, number ];
	/** 相对水平水面的 XYZ 旋转，单位为弧度。 */
	rotation?: readonly [ number, number, number ];
};

/** 积水贴片系统的初始化参数。 */
export type PuddlePatchSystemOptions = {
	/** 积水贴片配置，至少包含一块贴片。 */
	patches: readonly PuddlePatchConfig[];
	/** 与雨滴共用的 5 秒线性降雨进度，范围为 0–1。 */
	rainProgress: THREE.IUniform<number>;
	/** 水层效果强度，范围为 0–1；0 关闭，1 保留完整菲涅耳反射。 */
	opacity?: number;
	/** 积水覆盖参数，范围为 0–1；0 全干，1 覆盖整个圆形贴片。 */
	coverage?: number;
	/** 相对基础噪声的水块尺寸倍率，越大水块越大。 */
	puddleScale?: number;
	/** 干湿边缘在噪声值中的过渡宽度。 */
	edgeSoftness?: number;
	/** 相对基础涟漪的尺寸倍率，越小涟漪越密。 */
	rippleScale?: number;
	/** 完全湿润后的水面粗糙度，范围为 0–1。 */
	roughness?: number;
	/** 反射模糊采样倍率，范围为 0–20。 */
	reflectionBlur?: number;
	/** 镜像反射亮度，范围为 0–1；菲涅耳权重独立计算。 */
	reflectionStrength?: number;
	/** 镜像渲染中需隐藏的天气对象与调试辅助对象。 */
	hideObjects?: readonly THREE.Object3D[];
};

/** 上游物理材质、噪声和涟漪的透明积水层；反射当前场景。 */
export class PuddlePatchSystem {
	/** 积水表面与调试网格的根节点。 */
	readonly group = new THREE.Group();
	private readonly waterGroup = new THREE.Group();
	private readonly gridGroup = new THREE.Group();
	private readonly patchMeshes: THREE.Mesh[] = [];
	private readonly gridMeshes: THREE.Mesh[] = [];
	private readonly gridMaterial: THREE.ShaderMaterial;
	private readonly material: PuddleMaterial;
	private readonly coverageUniforms = createPuddleCoverageUniforms();
	private readonly patches: Array<{
		position: [ number, number, number ];
		size: [ number, number ];
		rotation: [ number, number, number ];
	}>;
	private readonly reflection: PlanarReflection;
	private enabled = true;
	private gridVisible = false;
	private disposed = false;

	constructor( options: PuddlePatchSystemOptions ) {
		if ( options.patches.length === 0 ) throw new Error( 'PuddlePatchSystem requires at least one patch.' );
		this.patches = options.patches.map( ( patch ) => ( {
			position: [ ...patch.position ],
			size: [ Math.max( PLANE_SIZE_MIN, patch.size[ 0 ] ), Math.max( PLANE_SIZE_MIN, patch.size[ 1 ] ) ],
			rotation: patch.rotation ? [ ...patch.rotation ] : [ 0, 0, 0 ]
		} ) );
		this.material = createPuddleMaterial( options.rainProgress, options.opacity ?? 1, options.rippleScale ?? 1, this.coverageUniforms );
		this.setCoverage( options.coverage ?? this.getCoverage() );
		this.setPuddleScale( options.puddleScale ?? this.getPuddleScale() );
		this.setEdgeSoftness( options.edgeSoftness ?? this.getEdgeSoftness() );
		this.setRoughness( options.roughness ?? this.getRoughness() );
		this.setReflectionBlur( options.reflectionBlur ?? this.getReflectionBlur() );
		this.reflection = new PlanarReflection( [ this.group, ...( options.hideObjects ?? [] ) ] );
		this.material.uniforms.tSceneReflection.value = this.reflection.target.texture;
		this.material.uniforms.uReflectionMatrix.value = this.reflection.textureMatrix;
		this.material.uniforms.uReflectionStrength.value = THREE.MathUtils.clamp( options.reflectionStrength ?? 0.85, 0, 1 );
		this.gridMaterial = new THREE.ShaderMaterial( {
			name: 'PuddlePatchGridShader',
			uniforms: { gridDivisions: { value: 12 } },
			vertexShader: /* glsl */ `
				varying vec2 vGridUv;
				void main() {
					vGridUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}
			`,
			fragmentShader: /* glsl */ `
				uniform float gridDivisions;
				varying vec2 vGridUv;
				void main() {
					float circle = smoothstep( 0.7, 0.85, 1.2 - length( vGridUv - 0.5 ) );
					vec2 cell = fract( vGridUv * gridDivisions );
					vec2 lineDistance = min( cell, 1.0 - cell );
					float gridLine = 1.0 - smoothstep( 0.018, 0.045, min( lineDistance.x, lineDistance.y ) );
					float boundary = 1.0 - smoothstep( 0.025, 0.18, circle );
					float alpha = max( gridLine * 0.72, boundary * 0.9 ) * circle;
					if ( alpha < 0.01 ) discard;
					gl_FragColor = vec4( 0.22, 0.74, 0.97, alpha );
				}
			`,
			transparent: true,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			polygonOffsetUnits: -2,
			toneMapped: false
		} );
		this.group.name = 'PuddlePatchSystem';
		this.waterGroup.name = 'PuddlePatchSurfaces';
		this.gridGroup.name = 'PuddlePatchGrid';
		for ( const group of [ this.group, this.waterGroup, this.gridGroup ] ) group.userData.excludeFromCollider = true;
		this.gridGroup.visible = false;
		this.group.add( this.waterGroup, this.gridGroup );
		this.buildPatchMeshes();
		this.syncWaterVisibility();
	}

	/** 将对象加入镜像反射的隐藏列表。 */
	addHideObject( object: THREE.Object3D ) {
		this.reflection.addHideObject( object );
	}

	/** 从镜像反射的隐藏列表移除对象。 */
	removeHideObject( object: THREE.Object3D ) {
		this.reflection.removeHideObject( object );
	}

	/** 设置反射目标的像素尺寸并同步纹素采样步长。 */
	setReflectionSize( width: number, height: number ) {
		this.reflection.setSize( width, height );
		this.material.uniforms.uReflectionTexel.value.set( 1 / this.reflection.target.width, 1 / this.reflection.target.height );
	}

	/** 切换积水显示，并将反射标记为待更新。 */
	setEnabled( enabled: boolean ) {
		this.enabled = enabled;
		this.reflection.invalidate();
		this.material.uniforms.uReflectionReady.value = 0;
		this.syncWaterVisibility();
	}

	/** 返回积水系统的启用状态。 */
	getEnabled() {
		return this.enabled;
	}

	/** 实际水面网格，供飞溅采样；不包含调试网格。 */
	getSurfaceGroup() {
		return this.waterGroup;
	}

	/** 返回共享的着色器参数对象，使飞溅遮罩随调试设置同步更新。 */
	getCoverageUniforms() {
		return this.coverageUniforms;
	}

	/** 返回各贴片位姿和尺寸的副本。 */
	getPatches(): PuddlePatchConfig[] {
		return this.patches.map( ( patch ) => ( {
			position: [ ...patch.position ], size: [ ...patch.size ], rotation: [ ...patch.rotation ]
		} ) );
	}

	/** 返回指定贴片供位姿控件直接操作的水面网格。 */
	getPatchTransformObject( index: number ) {
		this.requirePatch( index );
		return this.patchMeshes[ index ];
	}

	/** 将控件修改的水面位姿写回配置，并同步调试网格。 */
	syncPatchFromTransformObject( index: number ) {
		const patch = this.requirePatch( index );
		const mesh = this.patchMeshes[ index ];
		const tiltInverse = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI / 2 );
		const rotation = mesh.quaternion.clone().multiply( tiltInverse );
		const euler = new THREE.Euler().setFromQuaternion( rotation, 'XYZ' );
		patch.position = [ mesh.position.x, mesh.position.y, mesh.position.z ];
		patch.size = [ Math.max( PLANE_SIZE_MIN, Math.abs( mesh.scale.x ) ), Math.max( PLANE_SIZE_MIN, Math.abs( mesh.scale.y ) ) ];
		patch.rotation = [ euler.x, euler.y, euler.z ];
		this.applyPatchTransform( index );
	}

	/** 切换积水调试网格显示。 */
	setGridVisible( visible: boolean ) {
		this.gridVisible = visible;
		this.gridGroup.visible = visible;
	}

	/** 返回积水调试网格的显示设置。 */
	getGridVisible() {
		return this.gridVisible;
	}

	/** 判断水面是否因启用状态、强度与覆盖参数而可见。 */
	isWaterVisible() {
		return this.waterGroup.visible;
	}

	/** 设置指定贴片的世界坐标并同步水面与调试网格。 */
	setPatchPosition( index: number, x: number, y: number, z: number ) {
		this.requirePatch( index ).position = [ x, y, z ];
		this.applyPatchTransform( index );
	}

	/** 设置指定贴片的宽度和长度，使用世界单位并限制最小尺寸。 */
	setPatchSize( index: number, width: number, depth: number ) {
		this.requirePatch( index ).size = [ Math.max( PLANE_SIZE_MIN, width ), Math.max( PLANE_SIZE_MIN, depth ) ];
		this.applyPatchTransform( index );
	}

	/** 设置指定贴片相对水平面的 XYZ 旋转，单位为弧度。 */
	setPatchRotation( index: number, x: number, y: number, z: number ) {
		this.requirePatch( index ).rotation = [ x, y, z ];
		this.applyPatchTransform( index );
	}

	/** 返回水层效果强度，范围为 0–1。 */
	getOpacity() {
		return this.material.uniforms.uOpacity.value as number;
	}

	/** 设置水层效果强度并限制在 0–1，同步水面可见性。 */
	setOpacity( opacity: number ) {
		this.material.uniforms.uOpacity.value = THREE.MathUtils.clamp( opacity, 0, 1 );
		this.syncWaterVisibility();
	}

	/** 返回积水覆盖参数，范围为 0–1。 */
	getCoverage() {
		return this.coverageUniforms.uPuddleCoverage.value;
	}

	/** 设置积水覆盖参数并限制在 0–1，同步水面可见性。 */
	setCoverage( coverage: number ) {
		this.coverageUniforms.uPuddleCoverage.value = THREE.MathUtils.clamp( coverage, 0, 1 );
		this.syncWaterVisibility();
	}

	/** 返回水块尺寸倍率。 */
	getPuddleScale() {
		return this.coverageUniforms.uPuddleScale.value;
	}

	/** 设置水块尺寸倍率，最小为 0.01。 */
	setPuddleScale( scale: number ) {
		this.coverageUniforms.uPuddleScale.value = Math.max( 0.01, scale );
	}

	/** 返回干湿边缘的噪声过渡宽度。 */
	getEdgeSoftness() {
		return this.coverageUniforms.uPuddleEdgeSoftness.value;
	}

	/** 设置干湿边缘过渡宽度并限制在 0.001–0.3。 */
	setEdgeSoftness( softness: number ) {
		this.coverageUniforms.uPuddleEdgeSoftness.value = THREE.MathUtils.clamp( softness, 0.001, 0.3 );
	}

	/** 设置非负的涟漪法线扰动强度。 */
	setRippleStrength( strength: number ) {
		this.material.uniforms.uRippleStrength.value = Math.max( 0, strength );
	}

	/** 返回涟漪法线扰动强度。 */
	getRippleStrength() {
		return this.material.uniforms.uRippleStrength.value as number;
	}

	/** 返回完全湿润后的水面粗糙度。 */
	getRoughness() {
		return this.material.uniforms.uWaterRoughness.value as number;
	}

	/** 设置水面粗糙度并限制在 0–1。 */
	setRoughness( roughness: number ) {
		const range = PUDDLE_PATCH_PARAMETER_RANGES.roughness;
		this.material.uniforms.uWaterRoughness.value = THREE.MathUtils.clamp( roughness, range.min, range.max );
	}

	/** 返回反射模糊采样倍率。 */
	getReflectionBlur() {
		return this.material.uniforms.uReflectionBlur.value as number;
	}

	/** 设置反射模糊采样倍率并限制在 0–20。 */
	setReflectionBlur( blur: number ) {
		const range = PUDDLE_PATCH_PARAMETER_RANGES.reflectionBlur;
		this.material.uniforms.uReflectionBlur.value = THREE.MathUtils.clamp( blur, range.min, range.max );
	}

	/** 按帧间隔秒数推进涟漪动画。 */
	update( delta: number ) {
		if ( ! this.enabled || this.disposed ) return;
		this.material.uniforms.uTime.value += Math.max( 0, Number.isFinite( delta ) ? delta : 0 );
	}

	/** 主渲染前绘制镜像场景；隐藏水面时不产生反射绘制。 */
	updateReflection( renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera ) {
		if ( ! this.waterGroup.visible || this.disposed ) return;
		const ready = this.reflection.update( renderer, scene, camera, this.patchMeshes[ 0 ] );
		this.material.uniforms.uReflectionReady.value = ready ? 1 : 0;
	}

	/** 释放水面、调试网格与反射资源，并移除积水节点。 */
	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.waterGroup.visible = false;
		this.patchMeshes.forEach( ( mesh ) => mesh.geometry.dispose() );
		this.gridMaterial.dispose();
		this.material.dispose();
		this.reflection.dispose();
		this.group.removeFromParent();
	}

	private syncWaterVisibility() {
		this.waterGroup.visible = this.enabled && ! this.disposed && this.getOpacity() > 0 && this.getCoverage() > 0;
	}

	private buildPatchMeshes() {
		for ( let index = 0; index < this.patches.length; index ++ ) {
			const geometry = new THREE.PlaneGeometry( 1, 1 );
			const mesh = new THREE.Mesh( geometry, this.material );
			mesh.name = `PuddlePatch-${ index + 1 }`;
			mesh.renderOrder = 40;
			mesh.userData.excludeFromCollider = true;
			this.patchMeshes.push( mesh );
			this.waterGroup.add( mesh );
			const grid = new THREE.Mesh( geometry, this.gridMaterial );
			grid.name = `PuddlePatchGrid-${ index + 1 }`;
			grid.renderOrder = 41;
			grid.userData.excludeFromCollider = true;
			this.gridMeshes.push( grid );
			this.gridGroup.add( grid );
			this.applyPatchTransform( index );
		}
	}

	private requirePatch( index: number ) {
		const patch = this.patches[ index ];
		if ( ! patch ) throw new RangeError( `Unknown puddle patch index: ${ index }` );
		return patch;
	}

	private applyPatchTransform( index: number ) {
		const patch = this.requirePatch( index );
		const mesh = this.patchMeshes[ index ];
		const grid = this.gridMeshes[ index ];
		const tilt = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), - Math.PI / 2 );
		const rotation = new THREE.Quaternion().setFromEuler( new THREE.Euler( ...patch.rotation, 'XYZ' ) );
		mesh.position.set( ...patch.position );
		mesh.quaternion.copy( rotation ).multiply( tilt );
		mesh.scale.set( patch.size[ 0 ], patch.size[ 1 ], 1 );
		mesh.updateMatrixWorld( true );
		const offset = new THREE.Vector3( 0, 0, GRID_SURFACE_OFFSET ).applyQuaternion( mesh.quaternion );
		grid.position.copy( mesh.position ).add( offset );
		grid.quaternion.copy( mesh.quaternion );
		grid.scale.copy( mesh.scale );
		grid.updateMatrixWorld( true );
		this.reflection.invalidate();
	}
}
