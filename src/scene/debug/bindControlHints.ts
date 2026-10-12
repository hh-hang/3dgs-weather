// 将键鼠输入映射到操作提示，显示按键、滚轮与视角移动反馈。

const LABEL_CODES: Record<string, string[]> = {
	W: [ 'KeyW', 'ArrowUp' ],
	A: [ 'KeyA', 'ArrowLeft' ],
	S: [ 'KeyS', 'ArrowDown' ],
	D: [ 'KeyD', 'ArrowRight' ],
	Shift: [ 'ShiftLeft', 'ShiftRight' ],
	Space: [ 'Space' ],
	E: [ 'KeyE' ],
	V: [ 'KeyV' ],
	F: [ 'KeyF' ],
	R: [ 'KeyR' ]
};

const BUTTON_CODES: Record<number, string> = {
	0: 'MouseLeft',
	2: 'MouseRight'
};

const codesFor = ( key: HTMLElement ) => {
	const label = key.textContent?.trim() ?? '';
	return LABEL_CODES[ label ] ?? [];
};

/** 绑定提示区域的键鼠反馈，使控件状态随当前输入更新。 */
export const bindControlHints = ( root: HTMLElement ) => {
	const keys = [ ...root.querySelectorAll<HTMLElement>( 'kbd' ) ];
	const mice = [ ...root.querySelectorAll<HTMLElement>( '.hint-mouse' ) ];
	const pressed = new Set<string>();
	let lookX = 0;
	let lookY = 0;
	let lookFrame = 0;
	let wheelTimer = 0;

	const render = () => {
		for ( const key of keys ) {
			key.classList.toggle( 'is-down', codesFor( key ).some( ( code ) => pressed.has( code ) ) );
		}
		for ( const mouse of mice ) {
			mouse.classList.toggle( 'is-left', pressed.has( 'MouseLeft' ) );
			mouse.classList.toggle( 'is-right', pressed.has( 'MouseRight' ) );
			mouse.classList.toggle( 'is-wheel', pressed.has( 'MouseWheel' ) );
			mouse.style.setProperty( '--look-x', `${ lookX }px` );
			mouse.style.setProperty( '--look-y', `${ lookY }px` );
		}
	};

	const settleLook = () => {
		lookX *= 0.84;
		lookY *= 0.84;
		if ( Math.abs( lookX ) < 0.04 && Math.abs( lookY ) < 0.04 ) {
			lookX = 0;
			lookY = 0;
			lookFrame = 0;
			render();
			return;
		}
		render();
		lookFrame = requestAnimationFrame( settleLook );
	};

	const onKeyDown = ( event: KeyboardEvent ) => {
		pressed.add( event.code );
		render();
	};
	const onKeyUp = ( event: KeyboardEvent ) => {
		pressed.delete( event.code );
		render();
	};
	const onMouseDown = ( event: MouseEvent ) => {
		const code = BUTTON_CODES[ event.button ];
		if ( code ) {
			pressed.add( code );
			render();
		}
	};
	const onMouseUp = ( event: MouseEvent ) => {
		const code = BUTTON_CODES[ event.button ];
		if ( code ) {
			pressed.delete( code );
			render();
		}
	};
	const onWheel = () => {
		pressed.add( 'MouseWheel' );
		render();
		window.clearTimeout( wheelTimer );
		wheelTimer = window.setTimeout( () => {
			pressed.delete( 'MouseWheel' );
			render();
		}, 160 );
	};
	const onMouseMove = ( event: MouseEvent ) => {
		if ( ! document.pointerLockElement && event.buttons === 0 ) {
			return;
		}
		lookX = Math.max( - 4, Math.min( 4, lookX + event.movementX * 0.28 ) );
		lookY = Math.max( - 4, Math.min( 4, lookY + event.movementY * 0.28 ) );
		render();
		if ( ! lookFrame ) {
			lookFrame = requestAnimationFrame( settleLook );
		}
	};

	window.addEventListener( 'keydown', onKeyDown );
	window.addEventListener( 'keyup', onKeyUp );
	window.addEventListener( 'mousedown', onMouseDown );
	window.addEventListener( 'mouseup', onMouseUp );
	window.addEventListener( 'wheel', onWheel, { passive: true } );
	window.addEventListener( 'mousemove', onMouseMove );
}
