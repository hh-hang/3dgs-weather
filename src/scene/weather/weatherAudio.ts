// 管理雨声、夜晚环境声与雷声，处理页面隐藏和浏览器播放限制。

const audioAssetUrl = ( fileName: string ) =>
	`${ import.meta.env.BASE_URL }audio/weather/${ fileName }`;

const createAudio = ( fileName: string, volume: number, loop = false ) => {

	const audio = new Audio( audioAssetUrl( fileName ) );
	audio.preload = 'auto';
	audio.loop = loop;
	audio.volume = volume;
	return audio;

};

const THUNDER_FILES = Array.from(
	{ length: 7 },
	( _, index ) => `thunder_${ String( index + 1 ).padStart( 2, '0' ) }.mp3`
);

/**
 * 场景环境音：雨声与夜晚环境声分别循环，闪电按 01–07 的顺序轮播雷声。
 *
 * HTMLMediaElement 可以让较长的环境音边下载边播放，避免一次性解码占用过多内存。
 * 如果浏览器拦截自动播放，会在下一次用户交互时自动重试环境声。
 */
export class WeatherAudio {

	private readonly rain = createAudio( 'rain.mp3', 0.58, true );
	private readonly night = createAudio( 'night.mp3', 0.34, true );
	private readonly thunder = THUNDER_FILES.map( ( fileName ) => createAudio( fileName, 0.66 ) );
	private rainEnabled = false;
	private nightEnabled = false;
	private suspended = false;
	private disposed = false;
	private unlockArmed = false;
	private thunderIndex = 0;

	constructor() {

		document.addEventListener( 'visibilitychange', this.handleVisibilityChange );

	}

	/** 切换雨声播放，关闭降雨时同时停止雷声。 */
	setRainEnabled( enabled: boolean ) {

		if ( this.rainEnabled === enabled ) {

			return;

		}

		this.rainEnabled = enabled;

		if ( ! enabled ) {

			this.stopThunder();

		}

		void this.syncPlayback();

	}

	/** 切换夜晚环境声播放。 */
	setNightEnabled( enabled: boolean ) {

		if ( this.nightEnabled === enabled ) {

			return;

		}

		this.nightEnabled = enabled;
		void this.syncPlayback();

	}

	/** 暂停或恢复环境音，保留天气与昼夜开关状态。 */
	setSuspended( suspended: boolean ) {

		if ( this.suspended === suspended ) {

			return;

		}

		this.suspended = suspended;
		void this.syncPlayback();

	}

	/** 每个雷电组事件立即调用一次，雷声严格按 01–07 循环。 */
	playThunder() {

		if ( ! this.canPlayRain() ) {

			return;

		}

		void this.playNextThunder();

	}

	/** 停止全部音频，移除监听并释放媒体资源。 */
	dispose() {

		if ( this.disposed ) {

			return;

		}

		this.disposed = true;
		this.stopAll();
		this.disarmUnlock();
		document.removeEventListener( 'visibilitychange', this.handleVisibilityChange );

		for ( const audio of [ this.rain, this.night, ...this.thunder ] ) {

			audio.removeAttribute( 'src' );
			audio.load();

		}

	}

	private canOutputAudio() {

		return ! this.suspended && ! this.disposed && ! document.hidden;

	}

	private canPlayRain() {

		return this.rainEnabled && this.canOutputAudio();

	}

	private canPlayNight() {

		return this.nightEnabled && this.canOutputAudio();

	}

	private async syncPlayback() {

		if ( ! this.canOutputAudio() ) {

			this.stopAll( false );
			return;

		}

		const attempts: Promise<boolean>[] = [];

		if ( this.rainEnabled ) {

			attempts.push( this.tryPlay( this.rain, () => this.canPlayRain() ) );

		} else {

			this.stopTrack( this.rain, true );

		}

		if ( this.nightEnabled ) {

			attempts.push( this.tryPlay( this.night, () => this.canPlayNight() ) );

		} else {

			this.stopTrack( this.night, true );

		}

		if ( attempts.length === 0 || ( await Promise.all( attempts ) ).every( Boolean ) ) {

			this.disarmUnlock();

		}

	}

	private async playNextThunder() {

		const audio = this.thunder[ this.thunderIndex ];
		audio.pause();
		audio.currentTime = 0;
		audio.volume = 0.56 + Math.random() * 0.18;
		audio.playbackRate = 1;

		if ( await this.tryPlay( audio, () => this.canPlayRain() ) ) {

			this.thunderIndex = ( this.thunderIndex + 1 ) % this.thunder.length;

		}

	}

	private async tryPlay( audio: HTMLAudioElement, canContinue: () => boolean ) {

		try {

			await audio.play();

			if ( ! canContinue() ) {

				audio.pause();
				return false;

			}

			return true;

		} catch {

			if ( canContinue() ) {

				this.armUnlock();

			}
			return false;

		}

	}

	private stopTrack( audio: HTMLAudioElement, reset: boolean ) {

		audio.pause();

		if ( reset ) {

			audio.currentTime = 0;

		}

	}

	private stopThunder() {

		for ( const audio of this.thunder ) {

			this.stopTrack( audio, true );

		}

	}

	private stopAll( resetAmbience = true ) {

		this.stopTrack( this.rain, resetAmbience );
		this.stopTrack( this.night, resetAmbience );
		this.stopThunder();

	}

	private armUnlock() {

		if ( this.unlockArmed ) {

			return;

		}

		this.unlockArmed = true;
		window.addEventListener( 'pointerdown', this.handleUnlock, true );
		window.addEventListener( 'keydown', this.handleUnlock, true );
		window.addEventListener( 'touchstart', this.handleUnlock, true );

	}

	private disarmUnlock() {

		if ( ! this.unlockArmed ) {

			return;

		}

		this.unlockArmed = false;
		window.removeEventListener( 'pointerdown', this.handleUnlock, true );
		window.removeEventListener( 'keydown', this.handleUnlock, true );
		window.removeEventListener( 'touchstart', this.handleUnlock, true );

	}

	private readonly handleUnlock = () => {

		void this.syncPlayback();

	};

	private readonly handleVisibilityChange = () => {

		void this.syncPlayback();

	};

}
