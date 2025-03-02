# Website of semfealumni
## Installation instructions
1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/)
2. `uv run mkdocs serve`

The website should now be available at http://localhost:8000/

### Troubleshooting

If you encounter the following error
```
ERROR   -  "cairosvg" Python module is installed, but it crashed with:
           no library called "cairo-2" was found
           no library called "cairo" was found
           no library called "libcairo-2" was found
           cannot load library 'libcairo.so.2': error 0x7e.  Additionally, ctypes.util.find_library() did not manage to locate a library called 'libcairo.so.2'
           cannot load library 'libcairo.2.dylib': error 0x7e.  Additionally, ctypes.util.find_library() did not manage to locate a library called 'libcairo.2.dylib'
           cannot load library 'libcairo-2.dll': error 0x7e.  Additionally, ctypes.util.find_library() did not manage to locate a library called 'libcairo-2.dll'

           --> Check out the troubleshooting guide: https://t.ly/MfX6u
```
then comment out `- social` from `mkdocs.yml`

## Development tools
- uv
- git
- terminal application
- code editor
- GitHub account