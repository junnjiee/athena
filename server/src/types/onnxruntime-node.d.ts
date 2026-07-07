/** Minimal typings for the optional onnxruntime-node dependency. The package is
 *  only imported when ATHENA_SEG_MODEL is set; installing it brings its own
 *  full typings which take precedence over this shim in editors, but tsc needs
 *  this to compile without the package present. */
declare module 'onnxruntime-node' {
  export class Tensor {
    constructor(type: string, data: Float32Array, dims: number[])
    readonly data: Float32Array
    readonly dims: readonly number[]
  }

  export interface OrtValue {
    readonly data: Float32Array
    readonly dims: readonly number[]
  }

  export interface InferenceSession {
    readonly inputNames: string[]
    readonly outputNames: string[]
    run(feeds: Record<string, Tensor>): Promise<Record<string, OrtValue>>
  }

  export const InferenceSession: {
    create(pathOrBuffer: string | Uint8Array): Promise<InferenceSession>
  }
}
