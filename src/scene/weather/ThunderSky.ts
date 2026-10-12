// 实现大气散射、程序化云层、夜空、月亮与云内雷电的天空着色。

import {
	BackSide,
	BoxGeometry,
	Color,
	type IUniform,
	Mesh,
	ShaderMaterial,
	UniformsUtils,
	Vector3
} from 'three';

/**
 * 基于 Three.js 天空实现的大气与天气着色：
 * - 采用 Preetham 大气散射模型
 * - 采用天空着色器的程序化云层
 * - 绘制受云层遮挡的夜空、星星与月亮
 * - 绘制云内闪电、光晕与云层局部照明
 */
class ThunderSky extends Mesh {

	/** 天空着色器定义，包含默认参数与顶点、片元源码。 */
	static SkyShader: {
		/** 着色器名称。 */
		name: string;
		/** 天空各效果的默认着色器参数。 */
		uniforms: Record<string, IUniform>;
		/** 顶点着色器源码。 */
		vertexShader: string;
		/** 片元着色器源码。 */
		fragmentShader: string;
	};

	/** 供渲染代码识别天空对象的标记。 */
	declare isSky: boolean;
	/** 供场景识别雷电天空对象的标记。 */
	declare isThunderSky: boolean;

	constructor() {

		const shader = ThunderSky.SkyShader;

		const material = new ShaderMaterial( {
			name: shader.name,
			uniforms: UniformsUtils.clone( shader.uniforms ),
			vertexShader: shader.vertexShader,
			fragmentShader: shader.fragmentShader,
			side: BackSide,
			depthWrite: false
		} );

		super( new BoxGeometry( 1, 1, 1 ), material );

		this.isSky = true;
		this.isThunderSky = true;

	}

	/** 当前天空实例独立持有的着色材质。 */
	declare material: ShaderMaterial;

}

ThunderSky.SkyShader = {

	name: 'ThunderSkyShader',

	uniforms: {
		'turbidity': { value: 2 },
		'rayleigh': { value: 1 },
		'mieCoefficient': { value: 0.005 },
		'mieDirectionalG': { value: 0.8 },
		'sunPosition': { value: new Vector3() },

		// 程序化云层的尺度、速度、覆盖与密度参数。
		'cloudScale': { value: 0.0002 },
		'cloudSpeed': { value: 0.00002 },
		'cloudCoverage': { value: 0.4 },
		'cloudDensity': { value: 0.4 },
		'cloudElevation': { value: 0.5 },

		'showSunDisc': { value: 1 },
		'time': { value: 0.0 },

		// 开场揭幕参数；默认显示完整天空，由场景在高斯点展开后推进揭幕。
		'revealProgress': { value: 1.0 },
		'revealGlowColor': { value: new Color( 1, 1, 1 ) },
		'revealGlowStrength': { value: 0.3 },

		// 夜空、星星和月亮参数；月亮方向由场景时间同步为太阳的反方向。
		'moonDirection': { value: new Vector3( 0.45, 0.55, 0.7 ).normalize() },
		'moonColor': { value: new Color( 0xdde8ff ) },
		'moonIntensity': { value: 2.2 },
		'moonAngularRadius': { value: 0.0080 },
		'moonHaloSize': { value: 0.055 },
		// 夜空与星星的亮度适配场景的低曝光设置。
		'starIntensity': { value: 2.2 },
		'starDensity': { value: 0.62 },
		'starTwinkle': { value: 0.16 },
		'nightSkyIntensity': { value: 18.0 },

		// 雷电参数。
		// 三个雷电槽位独立声明，避免动态索引着色器参数数组的兼容性问题。
		// 未启用槽位的闪电和云层闪光强度均设为 0。

		// 雷电槽位 0。
		'lightningDirection0': { value: new Vector3( 0, 0.35, -1 ).normalize() },
		'lightningStrength0': { value: 0.0 },
		'cloudFlashStrength0': { value: 0.0 },
		'lightningColor0': { value: new Color( 0xcab6ff ) },
		'lightningWidth0': { value: 0.0018 },
		'lightningCloudRadius0': { value: 0.13 },
		'lightningSeed0': { value: 1.0 },
		'lightningAngle0': { value: 0.0 },
		'lightningLength0': { value: 0.42 },
		'lightningBend0': { value: 0.0 },
		'lightningJaggedness0': { value: 1.0 },
		'lightningBranchStrength0': { value: 0.5 },
		'lightningBranchStart0': { value: 0.0 },
		'lightningBranchSlope0': { value: 0.35 },
		'lightningCloudStretch0': { value: 1.8 },

		// 雷电槽位 1。
		'lightningDirection1': { value: new Vector3( 0.2, 0.40, -1 ).normalize() },
		'lightningStrength1': { value: 0.0 },
		'cloudFlashStrength1': { value: 0.0 },
		'lightningColor1': { value: new Color( 0xcab6ff ) },
		'lightningWidth1': { value: 0.0018 },
		'lightningCloudRadius1': { value: 0.13 },
		'lightningSeed1': { value: 2.0 },
		'lightningAngle1': { value: 0.0 },
		'lightningLength1': { value: 0.42 },
		'lightningBend1': { value: 0.0 },
		'lightningJaggedness1': { value: 1.0 },
		'lightningBranchStrength1': { value: 0.5 },
		'lightningBranchStart1': { value: 0.0 },
		'lightningBranchSlope1': { value: 0.35 },
		'lightningCloudStretch1': { value: 1.8 },

		// 雷电槽位 2。
		'lightningDirection2': { value: new Vector3( -0.2, 0.45, -1 ).normalize() },
		'lightningStrength2': { value: 0.0 },
		'cloudFlashStrength2': { value: 0.0 },
		'lightningColor2': { value: new Color( 0xcab6ff ) },
		'lightningWidth2': { value: 0.0018 },
		'lightningCloudRadius2': { value: 0.13 },
		'lightningSeed2': { value: 3.0 },
		'lightningAngle2': { value: 0.0 },
		'lightningLength2': { value: 0.42 },
		'lightningBend2': { value: 0.0 },
		'lightningJaggedness2': { value: 1.0 },
		'lightningBranchStrength2': { value: 0.5 },
		'lightningBranchStart2': { value: 0.0 },
		'lightningBranchSlope2': { value: 0.35 },
		'lightningCloudStretch2': { value: 1.8 }
	},

	vertexShader: /* glsl */`
		uniform vec3 sunPosition;
		uniform float rayleigh;
		uniform float turbidity;
		uniform float mieCoefficient;

		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		const float e = 2.71828182845904523536028747135266249775724709369995957;
		const float pi = 3.141592653589793238462643383279502884197169;

		const vec3 totalRayleigh = vec3(
			5.804542996261093E-6,
			1.3562911419845635E-5,
			3.0265902468824876E-5
		);

		const vec3 MieConst = vec3(
			1.8399918514433978E14,
			2.7798023919660528E14,
			4.0790479543861094E14
		);

		const float cutoffAngle = 1.6110731556870734;
		const float steepness = 1.5;
		const float EE = 1000.0;

		float sunIntensity( float zenithAngleCos ) {

			zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );

			return EE * max(
				0.0,
				1.0 - pow(
					e,
					-( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness )
				)
			);

		}

		vec3 totalMie( float T ) {

			float c = ( 0.2 * T ) * 10E-18;

			return 0.434 * c * MieConst;

		}

		void main() {

			vec4 worldPosition =
				modelMatrix * vec4( position, 1.0 );

			vWorldPosition =
				worldPosition.xyz;

			gl_Position =
				projectionMatrix *
				modelViewMatrix *
				vec4( position, 1.0 );

			// 将天空投影到远裁剪面，保持其位于场景物体之后。
			gl_Position.z =
				gl_Position.w;

			vSunDirection =
				normalize( sunPosition );

			vSunE =
				sunIntensity( vSunDirection.y );

			vSunfade =
				1.0 -
				clamp(
					1.0 -
					exp( sunPosition.y / 450000.0 ),
					0.0,
					1.0
				);

			float rayleighCoefficient =
				rayleigh -
				( 1.0 * ( 1.0 - vSunfade ) );

			vBetaR =
				totalRayleigh *
				rayleighCoefficient;

			vBetaM =
				totalMie( turbidity ) *
				mieCoefficient;

		}
	`,

	fragmentShader: /* glsl */`
		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		uniform float mieDirectionalG;

		uniform float cloudScale;
		uniform float cloudSpeed;
		uniform float cloudCoverage;
		uniform float cloudDensity;
		uniform float cloudElevation;

		uniform float showSunDisc;
		uniform float time;

		uniform float revealProgress;
		uniform vec3 revealGlowColor;
		uniform float revealGlowStrength;

		uniform vec3 moonDirection;
		uniform vec3 moonColor;
		uniform float moonIntensity;
		uniform float moonAngularRadius;
		uniform float moonHaloSize;
		uniform float starIntensity;
		uniform float starDensity;
		uniform float starTwinkle;
		uniform float nightSkyIntensity;

		// 三个独立雷电槽位的着色器参数。

		uniform vec3 lightningDirection0;
		uniform float lightningStrength0;
		uniform float cloudFlashStrength0;
		uniform vec3 lightningColor0;
		uniform float lightningWidth0;
		uniform float lightningCloudRadius0;
		uniform float lightningSeed0;
		uniform float lightningAngle0;
		uniform float lightningLength0;
		uniform float lightningBend0;
		uniform float lightningJaggedness0;
		uniform float lightningBranchStrength0;
		uniform float lightningBranchStart0;
		uniform float lightningBranchSlope0;
		uniform float lightningCloudStretch0;

		uniform vec3 lightningDirection1;
		uniform float lightningStrength1;
		uniform float cloudFlashStrength1;
		uniform vec3 lightningColor1;
		uniform float lightningWidth1;
		uniform float lightningCloudRadius1;
		uniform float lightningSeed1;
		uniform float lightningAngle1;
		uniform float lightningLength1;
		uniform float lightningBend1;
		uniform float lightningJaggedness1;
		uniform float lightningBranchStrength1;
		uniform float lightningBranchStart1;
		uniform float lightningBranchSlope1;
		uniform float lightningCloudStretch1;

		uniform vec3 lightningDirection2;
		uniform float lightningStrength2;
		uniform float cloudFlashStrength2;
		uniform vec3 lightningColor2;
		uniform float lightningWidth2;
		uniform float lightningCloudRadius2;
		uniform float lightningSeed2;
		uniform float lightningAngle2;
		uniform float lightningLength2;
		uniform float lightningBend2;
		uniform float lightningJaggedness2;
		uniform float lightningBranchStrength2;
		uniform float lightningBranchStart2;
		uniform float lightningBranchSlope2;
		uniform float lightningCloudStretch2;
		// 程序化云层噪声。
		vec2 gradient( vec2 i ) {

			vec3 p =
				fract(
					i.xyx *
					vec3(
						0.1031,
						0.1030,
						0.0973
					)
				);

			p +=
				dot(
					p,
					p.yzx + 33.33
				);

			return
				fract(
					( p.xx + p.yz ) *
					p.zy
				) *
				2.0 -
				1.0;

		}

		float noise( vec2 p ) {

			vec2 i =
				floor( p );

			vec2 f =
				fract( p );

			vec2 u =
				f * f * f *
				(
					f *
					( f * 6.0 - 15.0 ) +
					10.0
				);

			float a =
				dot(
					gradient( i ),
					f
				);

			float b =
				dot(
					gradient( i + vec2( 1.0, 0.0 ) ),
					f - vec2( 1.0, 0.0 )
				);

			float c =
				dot(
					gradient( i + vec2( 0.0, 1.0 ) ),
					f - vec2( 0.0, 1.0 )
				);

			float d =
				dot(
					gradient( i + vec2( 1.0, 1.0 ) ),
					f - vec2( 1.0, 1.0 )
				);

			return
				mix(
					mix( a, b, u.x ),
					mix( c, d, u.x ),
					u.y
				) *
				1.6;

		}

		float fbm(
			vec2 p,
			float drift
		) {

			float result =
				0.0;

			float amplitude =
				1.0;

			for (
				int i = 0;
				i < 4;
				i++
			) {

				result +=
					amplitude *
					noise( p );

				amplitude *=
					0.5;

				p =
					p * 2.0 +
					drift;

			}

			return result;

		}
		// 雷电路径的云层连续性检测。
		// 可见云层使用云密度遮罩，雷电额外采样邻域密度以维持路径连续。
		// 邻域云密度仅用于桥接小范围云洞。
		// 大面积晴空无法同时满足两侧有云的条件，因此不会生成桥接。
		float cloudPresenceAtUV(
			vec2 uv,
			float evolve
		) {

			float n =
				clamp(
					fbm(
						uv * 1000.0,
						evolve
					)
					*
					0.7
					+
					0.5,
					0.0,
					1.0
				);

			float r =
				noise(
					uv * 300.0
				)
				*
				0.37
				+
				0.5;

			float c =
				clamp(
					cloudCoverage +
					(
						r - 0.5
					)
					*
					0.6,
					0.0,
					1.0
				);

			float t =
				1.0 - c;

			return smoothstep(
				t,
				t + 0.3,
				n
			);

		}


		float lightningCloudContinuity(
			vec2 uv,
			float evolve,
			float centerMask
		) {

			// 检测范围随云层尺度同步，保持云洞判定的相对尺寸一致。
			float stepSize =
				max(
					cloudScale * 0.36,
					0.000025
				);

			float l = cloudPresenceAtUV( uv + vec2( -stepSize, 0.0 ), evolve );
			float r = cloudPresenceAtUV( uv + vec2(  stepSize, 0.0 ), evolve );
			float d = cloudPresenceAtUV( uv + vec2( 0.0, -stepSize ), evolve );
			float u = cloudPresenceAtUV( uv + vec2( 0.0,  stepSize ), evolve );

			float d1 = cloudPresenceAtUV( uv + vec2( -stepSize, -stepSize ), evolve );
			float d2 = cloudPresenceAtUV( uv + vec2(  stepSize,  stepSize ), evolve );
			float d3 = cloudPresenceAtUV( uv + vec2( -stepSize,  stepSize ), evolve );
			float d4 = cloudPresenceAtUV( uv + vec2(  stepSize, -stepSize ), evolve );

			// 仅在云洞两侧均存在云层时桥接雷电路径。
			// 两侧密度约束可阻止雷电路径延伸到大片晴空。
			float oppositeSupport =
				max(
					max(
						min( l, r ),
						min( d, u )
					),
					max(
						min( d1, d2 ),
						min( d3, d4 )
					)
				);

			float bridge =
				smoothstep(
					0.16,
					0.52,
					oppositeSupport
				);

			// 降低桥接区亮度，使云洞内的雷电弱于云层中的雷电。
			return max(
				centerMask,
				bridge * 0.58
			);

		}
		// 随机云内闪电的形状与噪声。
		void lightningBasis(
			vec3 L,
			out vec3 right,
			out vec3 up
		) {

			right =
				cross(
					vec3( 0.0, 1.0, 0.0 ),
					L
				);

			if (
				length( right ) <
				0.001
			) {

				right =
					vec3( 1.0, 0.0, 0.0 );

			} else {

				right =
					normalize( right );

			}

			up =
				normalize(
					cross(
						L,
						right
					)
				);

		}


		vec2 lightningLocalUV(
			vec3 direction,
			vec3 lightningDirection,
			float lightningAngle
		) {

			vec3 L =
				normalize(
					lightningDirection
				);

			vec3 right;
			vec3 up;

			lightningBasis(
				L,
				right,
				up
			);

			float x0 =
				dot(
					direction - L,
					right
				);

			float y0 =
				dot(
					direction - L,
					up
				);

			float c =
				cos(
					lightningAngle
				);

			float s =
				sin(
					lightningAngle
				);

			return vec2(
				x0 * c + y0 * s,
				-x0 * s + y0 * c
			);

		}


		float lightningBolt(
			vec3 direction,
			vec3 lightningDirection,
			float lightningAngle,
			float lightningLength,
			float lightningBend,
			float lightningJaggedness,
			float lightningSeed,
			float lightningWidth,
			float lightningBranchStrength,
			float lightningBranchStart,
			float lightningBranchSlope
		) {

			vec2 p =
				lightningLocalUV(
					direction,
					lightningDirection,
					lightningAngle
				);

			float x =
				p.x;

			float y =
				p.y;

			float halfLength =
				max(
					0.06,
					lightningLength *
					0.5
				);

			float path =
				lightningBend *
				(
					x * x -
					x * 0.08
				);

			path +=
				sin(
					x *
					(
						45.0 +
						lightningJaggedness *
						24.0
					)
					+
					lightningSeed *
					2.31
				)
				*
				0.0045 *
				lightningJaggedness;

			path +=
				noise(
					vec2(
						x *
						(
							28.0 +
							lightningJaggedness *
							20.0
						)
						+
						lightningSeed *
						4.7,
						lightningSeed *
						1.37
					)
				)
				*
				0.014 *
				lightningJaggedness;

			path +=
				noise(
					vec2(
						x * 145.0,
						lightningSeed *
						7.11
					)
				)
				*
				0.0045 *
				lightningJaggedness;

			float d =
				abs(
					y -
					path
				);

			float edgeSoftness =
				min(
					0.045,
					halfLength *
					0.35
				);

			float lengthMask =
				smoothstep(
					-halfLength,
					-halfLength +
					edgeSoftness,
					x
				)
				*
				(
					1.0 -
					smoothstep(
						halfLength -
						edgeSoftness,
						halfLength,
						x
					)
				);

			float core =
				lightningWidth /
				(
					d +
					lightningWidth
				);

			core =
				pow(
					core,
					7.5
				);

			float glow =
				0.010 /
				(
					d +
					0.010
				);

			glow =
				pow(
					glow,
					2.25
				);

			float bx =
				x -
				lightningBranchStart;

			float branchPath =
				path +
				bx *
				lightningBranchSlope;

			branchPath +=
				noise(
					vec2(
						bx * 95.0,
						lightningSeed *
						9.31
					)
				)
				*
				0.007;

			float branchDistance =
				abs(
					y -
					branchPath
				);

			float branchSide =
				step(
					0.0,
					bx
				);

			float reverseSide =
				step(
					0.5,
					fract(
						lightningSeed *
						0.173
					)
				);

			branchSide =
				mix(
					branchSide,
					1.0 -
					branchSide,
					reverseSide
				);

			float branchRange =
				1.0 -
				smoothstep(
					halfLength *
						0.15,
					halfLength *
						0.72,
					abs( bx )
				);

			float branch =
				pow(
					0.0012 /
					(
						branchDistance +
						0.0012
					),
					5.0
				)
				*
				branchSide
				*
				branchRange
				*
				lightningBranchStrength;

			float branch2Path =
				path -
				(
					x +
					lightningBranchStart *
					0.55
				)
				*
				lightningBranchSlope *
				0.72
				+
				0.012;

			branch2Path +=
				noise(
					vec2(
						x * 120.0,
						lightningSeed *
						13.7
					)
				)
				*
				0.005;

			float branch2Distance =
				abs(
					y -
					branch2Path
				);

			float branch2 =
				pow(
					0.0010 /
					(
						branch2Distance +
						0.0010
					),
					5.0
				)
				*
				smoothstep(
					0.55,
					0.95,
					lightningBranchStrength
				)
				*
				(
					1.0 -
					smoothstep(
						halfLength *
							0.30,
						halfLength *
							0.86,
						abs( x )
					)
				);

			return
				(
					core * 3.0 +
					glow * 0.58 +
					branch * 1.25 +
					branch2 * 0.85
				)
				*
				lengthMask;

		}


		float lightningCloudLight(
			vec3 direction,
			vec3 lightningDirection,
			float lightningAngle,
			float lightningCloudRadius,
			float lightningCloudStretch
		) {

			vec2 p =
				lightningLocalUV(
					direction,
					lightningDirection,
					lightningAngle
				);

			float stretch =
				max(
					0.45,
					lightningCloudStretch
				);

			float stretchedDistance =
				sqrt(
					pow(
						p.x /
						stretch,
						2.0
					)
					+
					pow(
						p.y,
						2.0
					)
				);

			float radius =
				max(
					0.018,
					lightningCloudRadius
				);

			float broadGlow =
				exp(
					-
					stretchedDistance *
					stretchedDistance
					/
					(
						radius *
						radius
					)
				);

			float innerGlow =
				exp(
					-
					stretchedDistance *
					stretchedDistance
					/
					(
						radius *
						radius *
						0.18
					)
				);

			return
				broadGlow +
				innerGlow *
				0.72;

		}
		// 大气散射常量。
		const float pi =
			3.141592653589793238462643383279502884197169;

		const float rayleighZenithLength =
			8.4E3;

		const float mieZenithLength =
			1.25E3;

		const float sunAngularDiameterCos =
			0.999956676946448443553574619906976478926848692873900859324;

		const float THREE_OVER_SIXTEENPI =
			0.05968310365946075;

		const float ONE_OVER_FOURPI =
			0.07957747154594767;

		float rayleighPhase(
			float cosTheta
		) {

			return
				THREE_OVER_SIXTEENPI *
				(
					1.0 +
					pow(
						cosTheta,
						2.0
					)
				);

		}

		float hgPhase(
			float cosTheta,
			float g
		) {

			float g2 =
				pow(
					g,
					2.0
				);

			float inverse =
				1.0 /
				pow(
					1.0 -
					2.0 *
					g *
					cosTheta +
					g2,
					1.5
				);

			return
				ONE_OVER_FOURPI *
				(
					(
						1.0 -
						g2
					) *
					inverse
				);

		}

		float hash21(
			vec2 p
		) {

			p =
				fract(
					p *
					vec2(
						123.34,
						456.21
					)
				);

			p +=
				dot(
					p,
					p + 45.32
				);

			return
				fract(
					p.x *
					p.y
				);

		}

		vec2 hash22(
			vec2 p
		) {

			float n =
				hash21( p );

			return vec2(
				n,
				hash21(
					p +
					n +
					19.19
				)
			);

		}

		float starField(
			vec3 direction
		) {

			float longitude =
				atan(
					direction.z,
					direction.x
				)
				/
				6.28318530718
				+
				0.5;

			float latitude =
				asin(
					clamp(
						direction.y,
						-1.0,
						1.0
					)
				)
				/
				3.14159265359
				+
				0.5;

			vec2 uv =
				vec2(
					longitude,
					latitude
				);

			vec2 grid =
				uv *
				vec2(
					520.0,
					230.0
				);

			vec2 cell =
				floor(
					grid
				);

			vec2 local =
				fract(
					grid
				);

			vec2 starPos =
				0.15 +
				hash22(
					cell
				)
				*
				0.70;

			float randomValue =
				hash21(
					cell +
					37.71
				);

			float threshold =
				mix(
					0.9985,
					0.9910,
					clamp(
						starDensity,
						0.0,
						1.0
					)
				);

			float exists =
				step(
					threshold,
					randomValue
				);

			float sizeRandom =
				hash21(
					cell +
					81.23
				);

			float radius =
				mix(
					0.080,
					0.2,
					sizeRandom *
					sizeRandom
				);

			float distanceToStar =
				length(
					local -
					starPos
				);

			float point =
				1.0 -
				smoothstep(
					radius *
					0.22,
					radius,
					distanceToStar
				);

			float brightness =
				mix(
					0.22,
					1.0,
					pow(
						hash21(
							cell +
							129.77
						),
						2.2
					)
				);

			float twinkleSpeed =
				mix(
					0.75,
					2.2,
					hash21(
						cell +
						211.53
					)
				);

			float twinkle =
				1.0 +
				sin(
					time *
					twinkleSpeed
					+
					randomValue *
					50.0
				)
				*
				starTwinkle;

			return
				exists *
				point *
				brightness *
				max(
					0.0,
					twinkle
				);

		}

		void getMoon(
			vec3 direction,
			out float moonDisc,
			out float moonHalo,
			out float moonSurface
		) {

			vec3 M =
				normalize(
					moonDirection
				);

			float angularDistance =
				sqrt(
					max(
						0.0,
						2.0 -
						2.0 *
						dot(
							direction,
							M
						)
					)
				);

			float radius =
				max(
					0.001,
					moonAngularRadius
				);

			moonDisc =
				1.0 -
				smoothstep(
					radius *
					0.82,
					radius,
					angularDistance
				);

			float haloRadius =
				max(
					radius *
					1.5,
					moonHaloSize
				);

			moonHalo =
				exp(
					-
					angularDistance *
					angularDistance
					/
					(
						haloRadius *
						haloRadius
					)
				)
				*
				0.18;

			float surfaceNoise =
				noise(
					vec2(
						direction.x +
						direction.z,
						direction.y -
						direction.z
					)
					*
					620.0
				);

			moonSurface =
				clamp(
					0.88 +
					surfaceNoise *
					0.12,
					0.68,
					1.0
				);

		}

		// 按仰角从地平线向天顶揭幕，柔光边缘使用固定噪声形成细微颗粒。
		vec3 applySkyReveal( vec3 skyColor, vec3 direction ) {

			float progress = clamp( revealProgress, 0.0, 1.0 );
			if ( progress >= 1.0 ) {
				return skyColor;
			}

			float elevation = asin( clamp( direction.y, -1.0, 1.0 ) ) / ( pi * 0.5 );
			float movement = smoothstep( 0.0, 1.0, progress );
			float front = mix( -0.1, 1.1, movement );
			float grain = noise( direction.xz * 140.0 + vec2( direction.y * 37.0 ) );
			float distanceToFront = elevation - front + grain * 0.008;
			float visibility = 1.0 - smoothstep( -0.07, 0.07, distanceToFront );

			// 亮带在启动与收尾时淡入淡出，亮度适配场景的低曝光设置。
			float glowDistance = distanceToFront / 0.055;
			float glow = exp( -glowDistance * glowDistance );
			glow *= smoothstep( 0.0, 0.12, progress )
				* ( 1.0 - smoothstep( 0.78, 1.0, progress ) );
			glow *= 0.9 + grain * 0.1;
			float luminance = dot( max( skyColor, vec3( 0.0 ) ), vec3( 0.2126, 0.7152, 0.0722 ) );
			float glowBrightness = clamp( luminance, 1.0, 5.0 ) * 3.0;

			vec3 baseColor = mix(
				vec3( 0.16, 0.20, 0.28 ), vec3( 0.035, 0.055, 0.095 ),
				clamp( elevation, 0.0, 1.0 )
			);
			baseColor *= mix( 0.25, 1.0, smoothstep( -0.05, 0.25, vSunDirection.y ) );
			return mix( baseColor, skyColor, visibility )
				+ revealGlowColor * glow * max( 0.0, revealGlowStrength ) * glowBrightness;

		}

		void main() {

			vec3 direction =
				normalize(
					vWorldPosition -
					cameraPosition
				);
			// 大气散射。
			float zenithAngle =
				acos(
					max(
						0.0,
						direction.y
					)
				);

			float inverse =
				1.0 /
				(
					cos(
						zenithAngle
					)
					+
					0.15 *
					pow(
						93.885 -
						(
							(
								zenithAngle *
								180.0
							)
							/
							pi
						),
						-1.253
					)
				);

			float sR =
				rayleighZenithLength *
				inverse;

			float sM =
				mieZenithLength *
				inverse;

			vec3 Fex =
				exp(
					-
					(
						vBetaR * sR +
						vBetaM * sM
					)
				);

			float cosTheta =
				dot(
					direction,
					vSunDirection
				);

			float rPhase =
				rayleighPhase(
					cosTheta * 0.5 +
					0.5
				);

			vec3 betaRTheta =
				vBetaR *
				rPhase;

			float mPhase =
				hgPhase(
					cosTheta,
					mieDirectionalG
				);

			vec3 betaMTheta =
				vBetaM *
				mPhase;

			vec3 Lin =
				pow(
					vSunE *
					(
						(
							betaRTheta +
							betaMTheta
						)
						/
						(
							vBetaR +
							vBetaM
						)
					)
					*
					(
						1.0 -
						Fex
					),
					vec3( 1.5 )
				);

			Lin *=
				mix(
					vec3( 1.0 ),
					pow(
						vSunE *
						(
							(
								betaRTheta +
								betaMTheta
							)
							/
							(
								vBetaR +
								vBetaM
							)
						)
						*
						Fex,
						vec3( 0.5 )
					),
					clamp(
						pow(
							1.0 -
							vSunDirection.y,
							5.0
						),
						0.0,
						1.0
					)
				);

			vec3 L0 =
				vec3( 0.1 ) *
				Fex;

			float sundisc =
				clamp(
					(
						cosTheta -
						sunAngularDiameterCos
					)
					*
					50000.0,
					0.0,
					1.0
				)
				*
				showSunDisc;

			vec3 sundiscColor =
				(
					760.0 *
					sundisc
				)
				*
				min(
					vSunE *
					Fex,
					80.0
				);

			vec3 texColor =
				(
					Lin +
					L0
				)
				*
				0.04
				+
				sundiscColor
				+
				vec3(
					0.0,
					0.0003,
					0.00075
				);

			// 太阳接近地平线时，大气散射在低曝光下迅速变暗。
			// 在日间颜色变暗前引入夜空，保持昼夜过渡的亮度连续。
			float nightFromSun =
				1.0 -
				smoothstep(
					0.04,
					0.20,
					vSunDirection.y
				);

			float dayLuma =
				dot(
					texColor,
					vec3( 0.2126, 0.7152, 0.0722 )
				);

			float nightFromDark =
				(
					1.0 -
					smoothstep(
						0.35,
						1.8,
						dayLuma
					)
				)
				*
				(
					1.0 -
					smoothstep(
						0.08,
						0.32,
						vSunDirection.y
					)
				);

			float nightFactor =
				clamp(
					max(
						nightFromSun,
						nightFromDark
					),
					0.0,
					1.0
				);

			float moonVisibility =
				1.0 -
				smoothstep(
					0.02,
					0.16,
					vSunDirection.y
				);

			float moonAboveHorizon =
				smoothstep(
					-0.015,
					0.035,
					moonDirection.y
				);

			float skyHeight =
				pow(
					clamp(
						direction.y,
						0.0,
						1.0
					),
					0.42
				);

			vec3 nightHorizonColor =
				vec3(
					0.010,
					0.017,
					0.036
				)
				*
				nightSkyIntensity;

			vec3 nightZenithColor =
				vec3(
					0.0015,
					0.0035,
					0.014
				)
				*
				nightSkyIntensity;

			vec3 nightColor =
				mix(
					nightHorizonColor,
					nightZenithColor,
					skyHeight
				);

			texColor =
				mix(
					texColor,
					nightColor,
					nightFactor *
					0.985
				);

			// 只在地平线以上出现星星。
			float starHorizonMask =
				smoothstep(
					0.0,
					0.04,
					direction.y
				);

			float stars =
				starField(
					direction
				)
				*
				nightFactor
				*
				starHorizonMask
				*
				starIntensity;

			texColor +=
				vec3(
					0.78,
					0.86,
					1.0
				)
				*
				stars;

			float moonDisc;
			float moonHalo;
			float moonSurface;

			getMoon(
				direction,
				moonDisc,
				moonHalo,
				moonSurface
			);

			float moonFactor =
				moonVisibility *
				moonAboveHorizon *
				moonIntensity;

			texColor +=
				moonColor *
				(
					moonDisc *
					moonSurface
					+
					moonHalo
				)
				*
				moonFactor;

			// 地平线遮罩。
			// 所有雷电和云闪都不能进入地平线以下。
			float horizonMask =
				smoothstep(
					0.0,
					0.015,
					direction.y
				);
			// 云层与局部雷电照明。
			if (
				direction.y > 0.0 &&
				cloudCoverage > 0.0
			) {

				float elevation =
					mix(
						1.0,
						0.1,
						cloudElevation
					);

				vec2 cloudUV =
					direction.xz /
					(
						direction.y *
						elevation
					);

				cloudUV *=
					cloudScale;

				cloudUV +=
					time *
					cloudSpeed;

				float evolve =
					time *
					cloudSpeed *
					300.0;

				float cloudNoise =
					clamp(
						fbm(
							cloudUV *
							1000.0,
							evolve
						)
						*
						0.7
						+
						0.5,
						0.0,
						1.0
					);

				float region =
					noise(
						cloudUV *
						300.0
					)
					*
					0.37
					+
					0.5;

				float cov =
					clamp(
						cloudCoverage +
						(
							region -
							0.5
						)
						*
						0.6,
						0.0,
						1.0
					);

				float threshold =
					1.0 -
					cov;

				float rawCloudMask =
					smoothstep(
						threshold,
						threshold +
						0.3,
						cloudNoise
					);

				float horizonFade =
					smoothstep(
						0.0,
						0.03 +
						0.06 *
						cloudElevation,
						direction.y
					);

				float cloudMask =
					rawCloudMask *
					horizonFade;

				// 雷电路径的连续云层遮罩。
				// 桥接局部云洞，保留大面积晴空的遮罩边界。
				float boltContinuityCloud =
					lightningCloudContinuity(
						cloudUV,
						evolve,
						rawCloudMask
					)
					*
					horizonFade;

				vec3 sunColor =
					vSunE *
					Fex *
					0.22 *
					0.04;

				vec3 skyAmbient =
					Lin *
					0.04
					+
					vec3(
						0.0,
						0.0003,
						0.00075
					);

				float depth =
					max(
						0.0,
						cloudNoise -
						threshold
					);

				float beer =
					exp(
						depth *
						-4.0
					);

				float powder =
					1.0 -
					beer *
					beer;

				float shade =
					mix(
						0.45,
						1.0,
						clamp(
							beer *
							powder *
							2.6,
							0.0,
							1.0
						)
					);

				float silver =
					clamp(
						0.51 /
						pow(
							1.49 -
							cosTheta *
							1.4,
							1.5
						),
						0.0,
						3.0
					);

				float edge =
					cloudMask *
					(
						1.0 -
						cloudMask
					)
					*
					4.0;

				vec3 cloudColor =
					skyAmbient +
					sunColor *
					shade;

				cloudColor +=
					sunColor *
					silver *
					edge *
					0.6;

				// 太阳落到地平线以下后关闭云层直射光，避免夜间保留日间云色。
				cloudColor *=
					smoothstep(
						-0.06,
						0.22,
						vSunDirection.y
					);

				// 太阳接近地平线时为朝阳云面叠加暖色，随太阳降低逐渐衰减。
				float twilight =
					(
						1.0 -
						smoothstep(
							0.0,
							0.16,
							vSunDirection.y
						)
					)
					*
					smoothstep(
						-0.22,
						-0.04,
						vSunDirection.y
					);

				float sunGlow =
					pow(
						max(
							0.0,
							dot(
								direction,
								normalize( vSunDirection )
							)
						),
						2.0
					);

				cloudColor +=
					vec3( 1.0, 0.42, 0.18 ) *
					twilight *
					(
						0.05 +
						sunGlow *
						0.2
					);

				// 夜间云层使用月光照明，按朝月方向区分明暗。
				float moonCloudFacing =
					pow(
						max(
							0.0,
							dot(
								direction,
								normalize(
									moonDirection
								)
							)
						),
						5.0
					);

				cloudColor +=
					moonColor *
					moonIntensity *
					nightFactor *
					moonAboveHorizon *
					(
						0.012 +
						moonCloudFacing *
						0.11
					);

				float alpha =
					(
						1.0 -
						exp(
							depth *
							cloudDensity *
							-12.0
						)
					)
					*
					horizonFade;
				// 合成一至三条独立云内雷电。
				float cloudOnlyMask =
					smoothstep(
						0.10,
						0.48,
						cloudMask
					)
					*
					smoothstep(
						0.025,
						0.26,
						alpha
					);

				float densityResponse =
					clamp(
						0.25 +
						cloudNoise *
						1.35,
						0.0,
						1.5
					);

				// 云层闪光槽位 0。
				float localFlash0 =
					lightningCloudLight(
						direction,
						lightningDirection0,
						lightningAngle0,
						lightningCloudRadius0,
						lightningCloudStretch0
					)
					*
					cloudFlashStrength0
					*
					horizonMask
					*
					cloudOnlyMask;

				cloudColor +=
					lightningColor0 *
					localFlash0 *
					densityResponse *
					2.1;

				texColor +=
					lightningColor0 *
					localFlash0 *
					0.08;

				// 云层闪光槽位 1。
				float localFlash1 =
					lightningCloudLight(
						direction,
						lightningDirection1,
						lightningAngle1,
						lightningCloudRadius1,
						lightningCloudStretch1
					)
					*
					cloudFlashStrength1
					*
					horizonMask
					*
					cloudOnlyMask;

				cloudColor +=
					lightningColor1 *
					localFlash1 *
					densityResponse *
					2.1;

				texColor +=
					lightningColor1 *
					localFlash1 *
					0.08;

				// 云层闪光槽位 2。
				float localFlash2 =
					lightningCloudLight(
						direction,
						lightningDirection2,
						lightningAngle2,
						lightningCloudRadius2,
						lightningCloudStretch2
					)
					*
					cloudFlashStrength2
					*
					horizonMask
					*
					cloudOnlyMask;

				cloudColor +=
					lightningColor2 *
					localFlash2 *
					densityResponse *
					2.1;

				texColor +=
					lightningColor2 *
					localFlash2 *
					0.08;

				// 合成云层颜色。
				texColor -=
					L0 *
					0.04 *
					alpha;

				vec3 cloudAerial =
					mix(
						texColor,
						cloudColor,
						Fex
					);

				texColor =
					mix(
						texColor,
						cloudAerial,
						alpha
					);

				// 可见电流由云层遮罩限制。
				// 小云洞使用邻域云密度进行弱桥接，保持雷电路径连续。
				// 大面积无云区域的雷电权重保持为 0。
				float realCloudForBolt =
					smoothstep(
						0.10,
						0.48,
						cloudMask
					);

				float continuousCloudForBolt =
					smoothstep(
						0.12,
						0.52,
						boltContinuityCloud
					);

				float boltCloudMask =
					max(
						realCloudForBolt,
						continuousCloudForBolt * 0.62
					)
					*
					horizonMask;

				// 可见电流槽位 0。
				float bolt0 =
					lightningBolt(
						direction,
						lightningDirection0,
						lightningAngle0,
						lightningLength0,
						lightningBend0,
						lightningJaggedness0,
						lightningSeed0,
						lightningWidth0,
						lightningBranchStrength0,
						lightningBranchStart0,
						lightningBranchSlope0
					)
					*
					lightningStrength0
					*
					horizonMask;

				texColor +=
					lightningColor0 *
					bolt0 *
					boltCloudMask *
					(
						0.90 +
						alpha *
						1.35
					);

				// 可见电流槽位 1。
				float bolt1 =
					lightningBolt(
						direction,
						lightningDirection1,
						lightningAngle1,
						lightningLength1,
						lightningBend1,
						lightningJaggedness1,
						lightningSeed1,
						lightningWidth1,
						lightningBranchStrength1,
						lightningBranchStart1,
						lightningBranchSlope1
					)
					*
					lightningStrength1
					*
					horizonMask;

				texColor +=
					lightningColor1 *
					bolt1 *
					boltCloudMask *
					(
						0.90 +
						alpha *
						1.35
					);

				// 可见电流槽位 2。
				float bolt2 =
					lightningBolt(
						direction,
						lightningDirection2,
						lightningAngle2,
						lightningLength2,
						lightningBend2,
						lightningJaggedness2,
						lightningSeed2,
						lightningWidth2,
						lightningBranchStrength2,
						lightningBranchStart2,
						lightningBranchSlope2
					)
					*
					lightningStrength2
					*
					horizonMask;

				texColor +=
					lightningColor2 *
					bolt2 *
					boltCloudMask *
					(
						0.90 +
						alpha *
						1.35
					);

			}

			// 闪光照明限制在云层局部区域。
			// 雷光按云层密度透出。

			texColor = applySkyReveal( texColor, direction );

			// 地平线以下为纯黑，贴着地平线留一条很窄的过渡。
			texColor *=
				smoothstep(
					-0.02,
					0.0,
					direction.y
				);

			gl_FragColor =
				vec4(
					texColor,
					1.0
				);

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}
	`

};

export { ThunderSky };
