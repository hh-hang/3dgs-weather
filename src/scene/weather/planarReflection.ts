// 通过镜像相机和斜裁剪生成水面反射，维护离屏渲染状态。

import * as THREE from 'three';

/** 镜像相机与斜裁剪算法参考 Three.js 的 Reflector 实现（MIT 许可证）。 */
export class PlanarReflection {
	/** 水面反射的离屏渲染目标。 */
	readonly target = new THREE.WebGLRenderTarget( 512, 512, {
		type: THREE.HalfFloatType,
		depthBuffer: true,
		samples: 0,
		generateMipmaps: true,
		minFilter: THREE.LinearMipmapLinearFilter
	} );
	/** 将世界坐标投影到反射纹理的变换矩阵。 */
	readonly textureMatrix = new THREE.Matrix4();
	private readonly cameras = new WeakMap<THREE.PerspectiveCamera, THREE.PerspectiveCamera>();
	private readonly hideObjects = new Set<THREE.Object3D>();
	private readonly plane = new THREE.Plane();
	private readonly normal = new THREE.Vector3();
	private readonly planePosition = new THREE.Vector3();
	private readonly cameraPosition = new THREE.Vector3();
	private readonly rotation = new THREE.Matrix4();
	private readonly lookAt = new THREE.Vector3();
	private readonly view = new THREE.Vector3();
	private readonly aim = new THREE.Vector3();
	private readonly clip = new THREE.Vector4();
	private readonly q = new THREE.Vector4();
	private readonly viewProjection = new THREE.Matrix4();
	private readonly frustum = new THREE.Frustum();
	private readonly viewport = new THREE.Vector4();
	private readonly scissor = new THREE.Vector4();
	private ready = false;

	constructor( hidden: readonly THREE.Object3D[] ) {
		for ( const object of hidden ) this.hideObjects.add( object );
		this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.target.texture.name = 'PuddleSceneReflection';
	}

	/** 将对象加入镜像渲染的隐藏列表。 */
	addHideObject( object: THREE.Object3D ) {
		this.hideObjects.add( object );
	}

	/** 从镜像渲染的隐藏列表移除对象。 */
	removeHideObject( object: THREE.Object3D ) {
		this.hideObjects.delete( object );
	}

	/** 将反射内容标记为未就绪。 */
	invalidate() {
		this.ready = false;
	}

	/** 按像素设置反射尺寸，限制单边不超过 2048 且总像素不超过约 207 万。 */
	setSize( width: number, height: number ) {
		const w = Math.max( 64, Math.round( width ) );
		const h = Math.max( 64, Math.round( height ) );
		const scale = Math.min( 1, 2048 / Math.max( w, h ), Math.sqrt( 1920 * 1080 / ( w * h ) ) );
		const nextWidth = Math.max( 64, Math.round( w * scale ) );
		const nextHeight = Math.max( 64, Math.round( h * scale ) );
		if ( this.target.width === nextWidth && this.target.height === nextHeight ) return;
		this.target.setSize( nextWidth, nextHeight );
		this.invalidate();
	}

	/** 为可见且朝向相机的水面更新镜像反射；返回本次反射是否就绪。 */
	update( renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, surface: THREE.Mesh ) {
		if ( ! ( camera as THREE.PerspectiveCamera ).isPerspectiveCamera ) return false;
		const perspective = camera as THREE.PerspectiveCamera;
		surface.updateWorldMatrix( true, false );
		perspective.updateWorldMatrix( true, false );
		this.viewProjection.multiplyMatrices( perspective.projectionMatrix, perspective.matrixWorldInverse );
		this.frustum.setFromProjectionMatrix( this.viewProjection, perspective.coordinateSystem );
		if ( ! this.frustum.intersectsObject( surface ) ) return false;

		this.planePosition.setFromMatrixPosition( surface.matrixWorld );
		this.cameraPosition.setFromMatrixPosition( perspective.matrixWorld );
		this.rotation.extractRotation( surface.matrixWorld );
		this.normal.set( 0, 0, 1 ).transformDirection( this.rotation );
		this.view.subVectors( this.planePosition, this.cameraPosition );
		if ( this.view.dot( this.normal ) > 0 ) return false;

		let mirror = this.cameras.get( perspective );
		if ( ! mirror ) {
			mirror = new THREE.PerspectiveCamera();
			this.cameras.set( perspective, mirror );
		}
		mirror.copy( perspective, false );
		mirror.matrixAutoUpdate = true;
		mirror.matrixWorldAutoUpdate = true;
		// 镜像相机的前向和上向向量会反转水平轴。
		// 同步反转偏心视锥，保证越肩视角下的反射覆盖整个水面。
		mirror.filmOffset = - perspective.filmOffset;
		if ( mirror.view?.enabled ) {
			mirror.view.offsetX = mirror.view.fullWidth - mirror.view.width - mirror.view.offsetX;
		}
		this.view.reflect( this.normal ).negate().add( this.planePosition );
		this.rotation.extractRotation( perspective.matrixWorld );
		this.lookAt.set( 0, 0, -1 ).transformDirection( this.rotation ).add( this.cameraPosition );
		this.aim.subVectors( this.planePosition, this.lookAt ).reflect( this.normal ).negate().add( this.planePosition );
		mirror.position.copy( this.view );
		mirror.scale.setScalar( 1 );
		mirror.up.set( 0, 1, 0 ).transformDirection( this.rotation ).reflect( this.normal );
		mirror.lookAt( this.aim );
		mirror.updateMatrixWorld( true );
		mirror.projectionMatrix.copy( perspective.projectionMatrix );
		mirror.projectionMatrix.elements[ 8 ] *= -1;

		this.textureMatrix.set(
			0.5, 0, 0, 0.5,
			0, 0.5, 0, 0.5,
			0, 0, 0.5, 0.5,
			0, 0, 0, 1
		);
		this.textureMatrix.multiply( mirror.projectionMatrix ).multiply( mirror.matrixWorldInverse );
		this.plane.setFromNormalAndCoplanarPoint( this.normal, this.planePosition ).applyMatrix4( mirror.matrixWorldInverse );
		this.clip.set( this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant );
		const projection = mirror.projectionMatrix;
		this.q.set(
			( Math.sign( this.clip.x ) + projection.elements[ 8 ] ) / projection.elements[ 0 ],
			( Math.sign( this.clip.y ) + projection.elements[ 9 ] ) / projection.elements[ 5 ],
			-1,
			( 1 + projection.elements[ 10 ] ) / projection.elements[ 14 ]
		);
		const denominator = this.clip.dot( this.q );
		if ( Math.abs( denominator ) < 1e-8 ) return false;
		this.clip.multiplyScalar( 2 / denominator );
		projection.elements[ 2 ] = this.clip.x;
		projection.elements[ 6 ] = this.clip.y;
		projection.elements[ 10 ] = this.clip.z + 1 - 0.003;
		projection.elements[ 14 ] = this.clip.w;
		mirror.projectionMatrixInverse.copy( projection ).invert();

		const previousTarget = renderer.getRenderTarget();
		const previousCubeFace = renderer.getActiveCubeFace();
		const previousMipmap = renderer.getActiveMipmapLevel();
		const previousXr = renderer.xr.enabled;
		const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
		const previousShadowNeedsUpdate = renderer.shadowMap.needsUpdate;
		const previousAutoClear = renderer.autoClear;
		const previousScissorTest = renderer.getScissorTest();
		const previousColor = renderer.getClearColor( new THREE.Color() );
		const previousAlpha = renderer.getClearAlpha();
		renderer.getViewport( this.viewport );
		renderer.getScissor( this.scissor );
		const hidden = Array.from( this.hideObjects, object => ( { object, visible: object.visible } ) );
		try {
			for ( const { object } of hidden ) object.visible = false;
			renderer.xr.enabled = false;
			renderer.shadowMap.autoUpdate = false;
			renderer.shadowMap.needsUpdate = false;
			renderer.autoClear = true;
			renderer.setScissorTest( false );
			renderer.setRenderTarget( this.target );
			renderer.setClearColor( 0x000000, 0 );
			// 透明绘制可能关闭深度写入；清空反射目标前需恢复深度写入。
			renderer.state.buffers.depth.setMask( true );
			renderer.clear();
			renderer.render( scene, mirror );
			this.ready = true;
		} finally {
			renderer.setRenderTarget( previousTarget, previousCubeFace, previousMipmap );
			renderer.setViewport( this.viewport );
			renderer.setScissor( this.scissor );
			renderer.setScissorTest( previousScissorTest );
			renderer.setClearColor( previousColor, previousAlpha );
			renderer.xr.enabled = previousXr;
			renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
			renderer.shadowMap.needsUpdate = previousShadowNeedsUpdate;
			renderer.autoClear = previousAutoClear;
			for ( const { object, visible } of hidden ) object.visible = visible;
		}
		return this.ready;
	}

	/** 释放反射渲染目标并清空隐藏对象列表。 */
	dispose() {
		this.target.dispose();
		this.hideObjects.clear();
	}
}
