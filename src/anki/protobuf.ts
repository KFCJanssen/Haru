/** Minimal protobuf reader: enough for Anki's notetype, template and media messages. */

export type PbValue = number | Uint8Array
export type PbMessage = Map<number, PbValue[]>

export function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0
  let shift = 0
  for (;;) {
    const b = buf[pos++]
    result += (b & 0x7f) * 2 ** shift
    if (b < 0x80) return [result, pos]
    shift += 7
    if (shift > 63) throw new Error('Bad varint')
  }
}

export function decodeMessage(buf: Uint8Array): PbMessage {
  const out: PbMessage = new Map()
  let pos = 0
  while (pos < buf.length) {
    let key: number
    ;[key, pos] = readVarint(buf, pos)
    const field = Math.floor(key / 8)
    const wire = key & 7
    let value: PbValue
    if (wire === 0) {
      ;[value, pos] = readVarint(buf, pos)
    } else if (wire === 2) {
      let len: number
      ;[len, pos] = readVarint(buf, pos)
      value = buf.subarray(pos, pos + len)
      pos += len
    } else if (wire === 1) {
      value = buf.subarray(pos, pos + 8)
      pos += 8
    } else if (wire === 5) {
      value = buf.subarray(pos, pos + 4)
      pos += 4
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`)
    }
    const list = out.get(field)
    if (list) list.push(value)
    else out.set(field, [value])
  }
  return out
}

const utf8 = new TextDecoder()

export function pbString(msg: PbMessage, field: number): string {
  const v = msg.get(field)?.[0]
  return v instanceof Uint8Array ? utf8.decode(v) : ''
}

export function pbInt(msg: PbMessage, field: number): number {
  const v = msg.get(field)?.[0]
  return typeof v === 'number' ? v : 0
}

export function pbMessages(msg: PbMessage, field: number): PbMessage[] {
  return (msg.get(field) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map(decodeMessage)
}
