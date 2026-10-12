// 绑定页面控件、加载进度与场景状态，协调环视和漫游交互。

import {
	Clock3,
	CloudRain,
	CloudSun,
	Footprints,
	Orbit,
	SlidersHorizontal,
	Snowflake,
	Sun,
	X,
	createIcons
} from 'lucide';
import { onLanguageChange, t, translateDocument } from './i18n';
import { bindControlHints } from './scene/debug/bindControlHints';
import { WeatherScene, type SceneStatus, type ViewerMode } from './scene/WeatherScene';

createIcons( {
	icons: {
		Clock3,
		CloudRain,
		CloudSun,
		Footprints,
		Orbit,
		SlidersHorizontal,
		Snowflake,
		Sun,
		X
	}
} );

const requiredElement = <T extends HTMLElement>( id: string ) => {
	const element = document.getElementById( id );
	if ( ! element ) {
		throw new Error( `Missing element #${ id }` );
	}
	return element as T;
};

const stage = requiredElement<HTMLDivElement>( 'scene-stage' );
const loadingScreen = requiredElement<HTMLElement>( 'loading-screen' );
const loadingStatus = requiredElement<HTMLElement>( 'loading-status' );
const progressFill = requiredElement<HTMLSpanElement>( 'progress-fill' );
const progressTrack = document.querySelector<HTMLElement>( '.progress-track' );
const settingsTrigger = requiredElement<HTMLButtonElement>( 'settings-trigger' );
const settingsClose = requiredElement<HTMLButtonElement>( 'settings-close' );
const environmentPanel = requiredElement<HTMLElement>( 'environment-panel' );
const modeToggle = requiredElement<HTMLButtonElement>( 'mode-toggle' );
const walkHint = requiredElement<HTMLElement>( 'walk-hint' );
const rainToggle = requiredElement<HTMLInputElement>( 'rain-toggle' );
const snowToggle = requiredElement<HTMLInputElement>( 'snow-toggle' );
const lightingToggle = requiredElement<HTMLInputElement>( 'lighting-toggle' );
const skyToggle = requiredElement<HTMLInputElement>( 'sky-toggle' );
const timeSlider = requiredElement<HTMLInputElement>( 'time-slider' );
const timeOutput = requiredElement<HTMLOutputElement>( 'time-output' );
const fpsValue = requiredElement<HTMLSpanElement>( 'fps-value' );
const timeControl = document.querySelector<HTMLElement>( '.time-control' );

let loaderDismissed = false;
let targetProgress = 0;
let displayedProgress = 0;
let progressFrame = 0;
let loadComplete = false;
let viewerMode: ViewerMode = 'view';
let walkReady = false;
let fpsFrame = 0;
let fpsSampleStart = performance.now();
let fpsSampleFrames = 0;
const reduceMotion = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

const updateFps = ( time: number ) => {
	fpsSampleFrames += 1;
	const elapsed = time - fpsSampleStart;
	if ( elapsed >= 500 ) {
		fpsValue.textContent = String( Math.round( fpsSampleFrames * 1000 / elapsed ) );
		fpsSampleStart = time;
		fpsSampleFrames = 0;
	}
	fpsFrame = requestAnimationFrame( updateFps );
};

const resetFpsSample = () => {
	fpsSampleStart = performance.now();
	fpsSampleFrames = 0;
};

const dismissLoaderWhenReady = () => {
	if ( ! loadComplete || displayedProgress < 99.9 || loaderDismissed ) {
		return;
	}
	loaderDismissed = true;
	loadingScreen.classList.add( 'is-complete' );
	loadingScreen.setAttribute( 'aria-hidden', 'true' );
	scene.startSplatReveal();
};

const renderProgress = () => {
	const loadingAlpha = 0.78 - ( displayedProgress / 100 ) * 0.68;
	progressFill.style.width = `${ displayedProgress.toFixed( 2 ) }%`;
	loadingScreen.style.setProperty( '--loading-alpha', loadingAlpha.toFixed( 3 ) );
	progressTrack?.setAttribute( 'aria-valuenow', String( Math.round( displayedProgress ) ) );
	dismissLoaderWhenReady();
};

const animateProgress = () => {
	const remaining = targetProgress - displayedProgress;
	if ( remaining <= 0.05 ) {
		displayedProgress = targetProgress;
		progressFrame = 0;
		renderProgress();
		return;
	}

	displayedProgress = Math.min( targetProgress, displayedProgress + Math.max( 0.25, remaining * 0.09 ) );
	renderProgress();
	progressFrame = requestAnimationFrame( animateProgress );
};

const setProgressTarget = ( progress: number ) => {
	targetProgress = Math.max( targetProgress, progress );
	if ( reduceMotion || loadComplete ) {
		cancelAnimationFrame( progressFrame );
		progressFrame = 0;
		displayedProgress = targetProgress;
		renderProgress();
		return;
	}
	if ( ! progressFrame ) {
		progressFrame = requestAnimationFrame( animateProgress );
	}
};

const syncModeToggle = () => {
	const nextMode: ViewerMode = viewerMode === 'view' ? 'walk' : 'view';
	modeToggle.disabled = nextMode === 'walk' && ! walkReady;
	modeToggle.title = t( nextMode === 'walk' ? 'ui.walkMode' : 'ui.viewMode' );
	modeToggle.setAttribute( 'aria-label', t( nextMode === 'walk' ? 'ui.toWalk' : 'ui.toView' ) );
	for ( const icon of modeToggle.querySelectorAll<HTMLElement>( '.mode-icon' ) ) {
		icon.hidden = icon.dataset.for !== nextMode;
	}
};

const updateStatus = ( status: SceneStatus ) => {
	const progress = Math.round( Math.min( 100, Math.max( 0, status.progress ) ) );
	walkReady = status.walkReady;
	syncModeToggle();
	loadingScreen.classList.toggle( 'has-error', Boolean( status.error ) );
	const loadingMessage = status.error ? 'ui.loadFailed' : 'ui.loading';
	loadingStatus.setAttribute( 'data-i18n', loadingMessage );
	loadingStatus.textContent = t( loadingMessage );
	loadComplete = status.ready && ! status.error;
	setProgressTarget( loadComplete ? 100 : progress );

	if ( status.error ) {
		return;
	}

	dismissLoaderWhenReady();
};

const scene = new WeatherScene( stage, updateStatus, ( mode ) => {
	walkHint.dataset.hintMode = mode;
} );
walkHint.dataset.hintMode = 'on-foot';

const syncDebugFromHash = () => {
	scene.setDebug( window.location.hash === '#debug' );
};

const setPanelOpen = ( open: boolean ) => {
	environmentPanel.classList.toggle( 'is-open', open );
	environmentPanel.setAttribute( 'aria-hidden', String( ! open ) );
	settingsTrigger.setAttribute( 'aria-expanded', String( open ) );
};

const setMode = ( mode: ViewerMode ) => {
	viewerMode = mode;
	scene.setMode( mode );
	walkHint.hidden = mode !== 'walk';
	syncModeToggle();
};

const formatTime = ( minutes: number ) => {
	const hour = Math.floor( minutes / 60 ) % 24;
	const minute = minutes % 60;
	return `${ String( hour ).padStart( 2, '0' ) }:${ String( minute ).padStart( 2, '0' ) }`;
};

settingsTrigger.addEventListener( 'click', () => setPanelOpen( true ) );
settingsClose.addEventListener( 'click', () => setPanelOpen( false ) );
modeToggle.addEventListener( 'click', () => {
	setMode( viewerMode === 'view' ? 'walk' : 'view' );
	modeToggle.blur();
} );

rainToggle.addEventListener( 'change', () => {
	if ( rainToggle.checked ) {
		snowToggle.checked = false;
		scene.setSnow( false );
	}
	scene.setRain( rainToggle.checked );
} );

snowToggle.addEventListener( 'change', () => {
	if ( snowToggle.checked ) {
		rainToggle.checked = false;
		scene.setRain( false );
	}
	scene.setSnow( snowToggle.checked );
} );

lightingToggle.addEventListener( 'change', () => {
	const enabled = lightingToggle.checked;
	timeSlider.disabled = ! enabled;
	timeControl?.classList.toggle( 'is-disabled', ! enabled );
	if ( ! enabled ) {
		timeSlider.value = '720';
		timeOutput.value = '12:00';
		scene.setTimeOfDay( 0.5 );
	}
	scene.setLighting( enabled );
} );

skyToggle.addEventListener( 'change', () => scene.setSky( skyToggle.checked ) );
timeSlider.addEventListener( 'input', () => {
	const minutes = Number( timeSlider.value );
	timeOutput.value = formatTime( minutes );
	scene.setTimeOfDay( minutes / 1440 );
} );

document.addEventListener( 'keydown', ( event ) => {
	if ( event.key === 'Escape' && environmentPanel.classList.contains( 'is-open' ) ) {
		setPanelOpen( false );
	}
} );

document.addEventListener( 'pointerdown', ( event ) => {
	if (
		environmentPanel.classList.contains( 'is-open' )
		&& ! environmentPanel.contains( event.target as Node )
		&& ! settingsTrigger.contains( event.target as Node )
	) {
		setPanelOpen( false );
	}
} );

document.addEventListener( 'visibilitychange', resetFpsSample );
window.addEventListener( 'hashchange', syncDebugFromHash );
const syncLanguage = () => {
	translateDocument();
	syncModeToggle();
};
const unsubscribeLanguage = onLanguageChange( syncLanguage );
window.addEventListener( 'beforeunload', () => {
	cancelAnimationFrame( fpsFrame );
	document.removeEventListener( 'visibilitychange', resetFpsSample );
	window.removeEventListener( 'hashchange', syncDebugFromHash );
	unsubscribeLanguage();
	scene.dispose();
}, { once: true } );
bindControlHints( walkHint );
syncLanguage();
syncDebugFromHash();
fpsFrame = requestAnimationFrame( updateFps );
void scene.init();
