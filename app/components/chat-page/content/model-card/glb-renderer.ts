import { multiplyMatrices } from "./glb-model";

import type { GlbModel, Matrix, ModelPrimitive } from "./glb-model";

/** How the camera looks at the model: around its center, at a distance. */
export interface OrbitView {
  /** Rotation around the vertical axis, in radians. */
  readonly yaw: number;
  /** Rotation up or down, in radians, kept short of the poles. */
  readonly pitch: number;
  /** 1 shows the whole model; larger values come closer. */
  readonly zoom: number;
}

/** The view a model opens with and returns to with "Ansicht zurücksetzen". */
export const DEFAULT_ORBIT_VIEW: OrbitView = { yaw: 0.7, pitch: 0.35, zoom: 1 };

/** The narrowest and the widest zoom. */
export const ORBIT_ZOOM_RANGE = { minimum: 0.25, maximum: 12 } as const;

/** The browser offers no WebGL 2; the card shows the start image. */
export class WebGlUnavailableError extends Error {}

const FIELD_OF_VIEW = Math.PI / 4;

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aTexcoord;
uniform mat4 uModel;
uniform mat4 uViewProjection;
out vec3 vNormal;
out vec2 vTexcoord;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vTexcoord = aTexcoord;
  gl_Position = uViewProjection * world;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vTexcoord;
in vec3 vWorld;
uniform vec4 uBaseColor;
uniform sampler2D uTexture;
uniform bool uHasTexture;
uniform bool uHasNormals;
uniform bool uIsUnlit;
uniform float uAlphaCutoff;
uniform vec3 uLight;
out vec4 outColor;
void main() {
  vec4 color = uBaseColor;
  if (uHasTexture) color *= texture(uTexture, vTexcoord);
  if (uAlphaCutoff >= 0.0 && color.a < uAlphaCutoff) discard;
  if (!uIsUnlit) {
    vec3 normal = uHasNormals
      ? normalize(vNormal)
      : normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float diffuse = abs(dot(normal, normalize(uLight)));
    color.rgb *= 0.35 + 0.65 * diffuse;
  }
  outColor = vec4(color.rgb * color.a, color.a);
}`;

const ATTRIBUTES = { position: 0, normal: 1, texcoord: 2 } as const;

const UNIFORM_NAMES = [
  "uModel",
  "uViewProjection",
  "uBaseColor",
  "uTexture",
  "uHasTexture",
  "uHasNormals",
  "uIsUnlit",
  "uAlphaCutoff",
  "uLight",
] as const;

type UniformName = (typeof UNIFORM_NAMES)[number];

interface UploadedPrimitive {
  readonly source: ModelPrimitive;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly buffers: readonly WebGLBuffer[];
  readonly drawCount: number;
  readonly hasIndices: boolean;
}

function perspective(aspect: number, near: number, far: number): Matrix {
  const focal = 1 / Math.tan(FIELD_OF_VIEW / 2);
  const depth = 1 / (near - far);
  return Float32Array.from([
    focal / aspect,
    0,
    0,
    0,
    0,
    focal,
    0,
    0,
    0,
    0,
    (far + near) * depth,
    -1,
    0,
    0,
    2 * far * near * depth,
    0,
  ]);
}

function normalize(
  vector: readonly [number, number, number],
): [number, number, number] {
  const length = Math.hypot(...vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function lookAt(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
): Matrix {
  const forward = normalize([
    eye[0] - target[0],
    eye[1] - target[1],
    eye[2] - target[2],
  ]);
  const side = normalize(cross([0, 1, 0], forward));
  const up = cross(forward, side);
  return Float32Array.from([
    side[0],
    up[0],
    forward[0],
    0,
    side[1],
    up[1],
    forward[1],
    0,
    side[2],
    up[2],
    forward[2],
    0,
    -dot(side, eye),
    -dot(up, eye),
    -dot(forward, eye),
    1,
  ]);
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new WebGlUnavailableError("No shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true)
    throw new WebGlUnavailableError(gl.getShaderInfoLog(shader) ?? "Shader");
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.bindAttribLocation(program, ATTRIBUTES.position, "aPosition");
  gl.bindAttribLocation(program, ATTRIBUTES.normal, "aNormal");
  gl.bindAttribLocation(program, ATTRIBUTES.texcoord, "aTexcoord");
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true)
    throw new WebGlUnavailableError(gl.getProgramInfoLog(program) ?? "Link");
  return program;
}

function attribute(
  gl: WebGL2RenderingContext,
  location: number,
  values: Float32Array | null,
  size: number,
): WebGLBuffer | null {
  if (values === null) {
    gl.disableVertexAttribArray(location);
    return null;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  return buffer;
}

function upload(
  gl: WebGL2RenderingContext,
  primitive: ModelPrimitive,
): UploadedPrimitive {
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  const buffers = [
    attribute(gl, ATTRIBUTES.position, primitive.positions, 3),
    attribute(gl, ATTRIBUTES.normal, primitive.normals, 3),
    attribute(gl, ATTRIBUTES.texcoord, primitive.texcoords, 2),
  ].filter((buffer): buffer is WebGLBuffer => buffer !== null);
  if (primitive.indices) {
    const indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, primitive.indices, gl.STATIC_DRAW);
    buffers.push(indices);
  }
  gl.bindVertexArray(null);
  return {
    source: primitive,
    vertexArray,
    buffers,
    drawCount: primitive.indices?.length ?? primitive.vertexCount,
    hasIndices: primitive.indices !== null,
  };
}

/** Decodes an embedded image; a broken image leaves its meshes in their base color. */
async function uploadTexture(
  gl: WebGL2RenderingContext,
  image: GlbModel["images"][number],
): Promise<WebGLTexture | null> {
  try {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }),
    );
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    bitmap.close();
    return texture;
  } catch {
    return null;
  }
}

/**
 * Draws a {@link GlbModel} into a canvas with WebGL 2: its base colors and
 * embedded textures, lit from the camera, around the center of the model.
 * @remarks
 * It draws only when asked, so a still model costs nothing. Opaque and
 * masked meshes come first, blended ones after them.
 */
export class GlbRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly model: GlbModel;
  private readonly program: WebGLProgram;
  private readonly uniforms: ReadonlyMap<
    UniformName,
    WebGLUniformLocation | null
  >;
  private readonly primitives: readonly UploadedPrimitive[];
  private readonly textures: readonly (WebGLTexture | null)[];

  private constructor(
    gl: WebGL2RenderingContext,
    model: GlbModel,
    textures: readonly (WebGLTexture | null)[],
  ) {
    this.gl = gl;
    this.model = model;
    this.program = linkProgram(gl);
    this.uniforms = new Map(
      UNIFORM_NAMES.map((name) => [
        name,
        gl.getUniformLocation(this.program, name),
      ]),
    );
    this.primitives = model.primitives.map((primitive) =>
      upload(gl, primitive),
    );
    this.textures = textures;
  }

  /**
   * Prepares the drawing of a model in a canvas.
   * @param canvas - The canvas of the viewer.
   * @param model - The read model.
   * @returns The renderer with its meshes and textures uploaded.
   * @throws {WebGlUnavailableError} When the browser offers no WebGL 2.
   */
  public static async create(
    canvas: HTMLCanvasElement,
    model: GlbModel,
  ): Promise<GlbRenderer> {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      premultipliedAlpha: true,
      alpha: true,
    });
    if (!gl) throw new WebGlUnavailableError("WebGL 2 is not available");
    const textures = await Promise.all(
      model.images.map((image) => uploadTexture(gl, image)),
    );
    return new GlbRenderer(gl, model, textures);
  }

  /**
   * Sets the size of the drawing buffer.
   * @param width - Width in CSS pixels.
   * @param height - Height in CSS pixels.
   * @param pixelRatio - Device pixels per CSS pixel, at most 2.
   */
  public resize(width: number, height: number, pixelRatio: number): void {
    const ratio = Math.min(Math.max(pixelRatio, 1), 2);
    const canvas = this.gl.canvas;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
  }

  /**
   * Draws the model as the view shows it.
   * @param view - Rotation and zoom of the camera.
   */
  public render(view: OrbitView): void {
    const { gl, model } = this;
    const { width, height } = gl.canvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    const distance = model.radius / Math.sin(FIELD_OF_VIEW / 2) / view.zoom;
    const eye: [number, number, number] = [
      model.center[0] + distance * Math.cos(view.pitch) * Math.sin(view.yaw),
      model.center[1] + distance * Math.sin(view.pitch),
      model.center[2] + distance * Math.cos(view.pitch) * Math.cos(view.yaw),
    ];
    const projection = perspective(
      width / Math.max(height, 1),
      Math.max(distance - model.radius * 2, distance * 0.01),
      distance + model.radius * 4,
    );
    gl.uniformMatrix4fv(
      this.uniform("uViewProjection"),
      false,
      multiplyMatrices(projection, lookAt(eye, model.center)),
    );
    gl.uniform3f(
      this.uniform("uLight"),
      eye[0] - model.center[0],
      eye[1] - model.center[1] + distance * 0.5,
      eye[2] - model.center[2],
    );
    gl.uniform1i(this.uniform("uTexture"), 0);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const primitive of this.primitives)
      if (!primitive.source.isBlended) this.draw(primitive);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const primitive of this.primitives)
      if (primitive.source.isBlended) this.draw(primitive);
    gl.depthMask(true);
  }

  /** Frees the buffers, textures and program; the canvas stays. */
  public dispose(): void {
    const { gl } = this;
    for (const primitive of this.primitives) {
      for (const buffer of primitive.buffers) gl.deleteBuffer(buffer);
      gl.deleteVertexArray(primitive.vertexArray);
    }
    for (const texture of this.textures) gl.deleteTexture(texture);
    gl.deleteProgram(this.program);
  }

  private draw(primitive: UploadedPrimitive): void {
    const { gl } = this;
    const { source } = primitive;
    const texture =
      source.imageIndex === null
        ? null
        : (this.textures[source.imageIndex] ?? null);
    gl.uniformMatrix4fv(this.uniform("uModel"), false, source.world);
    gl.uniform4f(this.uniform("uBaseColor"), ...source.baseColor);
    gl.uniform1i(
      this.uniform("uHasTexture"),
      texture !== null && source.texcoords !== null ? 1 : 0,
    );
    gl.uniform1i(this.uniform("uHasNormals"), source.normals === null ? 0 : 1);
    gl.uniform1i(this.uniform("uIsUnlit"), source.isUnlit ? 1 : 0);
    gl.uniform1f(this.uniform("uAlphaCutoff"), source.alphaCutoff ?? -1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindVertexArray(primitive.vertexArray);
    if (primitive.hasIndices)
      gl.drawElements(gl.TRIANGLES, primitive.drawCount, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, primitive.drawCount);
    gl.bindVertexArray(null);
  }

  private uniform(name: UniformName): WebGLUniformLocation | null {
    return this.uniforms.get(name) ?? null;
  }
}
