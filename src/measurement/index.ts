// `.guitartap` measurement model + (de)serialization. Canonical format spec:
// Swift user manual Appendix B (Documentation/Manual/app-b-file-formats.md).
export * from './types'
export { parseGuitarTapFile, decodeMeasurement, decodeSnapshot } from './decode'
export { serializeGuitarTapFile, encodeMeasurement, encodeSnapshot } from './encode'
export { f32, f32List } from './floatJson'
export { floatsToBase64, base64ToFloats } from './base64'