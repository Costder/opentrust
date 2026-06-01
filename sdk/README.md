# opentrust-sdk

Python SDK for OpenTrust, the trust registry and passport layer for AI-agent tools.

Use it to verify tools, fetch passports, search the registry, and expose an MCP bridge for agent runtimes.

## Install

```bash
pip install opentrust-sdk
```

For MCP support:

```bash
pip install 'opentrust-sdk[mcp]'
```

## Basic usage

```python
import asyncio
from opentrust import verify

async def main():
    result = await verify('github/file-search-mcp')
    print(result)

asyncio.run(main())
```

## MCP bridge

```bash
opentrust-mcp
```

## Repository

https://github.com/Costder/opentrust

## License

MIT
