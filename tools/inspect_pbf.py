"""Small unknown-schema protobuf inspector for licensed map investigation."""

from __future__ import annotations

import argparse
from pathlib import Path


def varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
        if shift > 63:
            break
    raise ValueError("Invalid varint")


def printable(payload: bytes) -> str | None:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not text or any(ord(char) < 32 and char not in "\r\n\t" for char in text):
        return None
    return text


def parse_message(data: bytes, depth: int = 0, max_depth: int = 3, limit: int = 80) -> list[str]:
    lines: list[str] = []
    offset = 0
    count = 0
    while offset < len(data) and count < limit:
        try:
            tag, offset = varint(data, offset)
        except ValueError:
            break
        field = tag >> 3
        wire = tag & 7
        indent = "  " * depth
        count += 1
        if wire == 0:
            try:
                value, offset = varint(data, offset)
            except ValueError:
                break
            lines.append(f"{indent}{field}: varint {value}")
        elif wire == 1:
            value = data[offset : offset + 8]
            offset += 8
            lines.append(f"{indent}{field}: fixed64 {value.hex()}")
        elif wire == 2:
            try:
                length, offset = varint(data, offset)
            except ValueError:
                break
            payload = data[offset : offset + length]
            offset += length
            text = printable(payload)
            if text is not None:
                lines.append(f"{indent}{field}: str[{length}] {text[:160]!r}")
            else:
                lines.append(f"{indent}{field}: bytes[{length}] {payload[:24].hex()}")
                if depth < max_depth and length > 2:
                    child = parse_message(payload, depth + 1, max_depth, limit)
                    if child:
                        lines.append(f"{indent}  {{")
                        lines.extend(child)
                        lines.append(f"{indent}  }}")
        elif wire == 5:
            value = data[offset : offset + 4]
            offset += 4
            lines.append(f"{indent}{field}: fixed32 {value.hex()}")
        else:
            lines.append(f"{indent}{field}: unsupported wire type {wire}")
            break
    return lines


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--depth", type=int, default=3)
    parser.add_argument("--limit", type=int, default=80)
    args = parser.parse_args()
    data = args.path.read_bytes()
    print("\n".join(parse_message(data, max_depth=args.depth, limit=args.limit)))


if __name__ == "__main__":
    main()
