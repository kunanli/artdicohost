"""Fixed cloud candidate entry; reuse only the verified offline Node decoder."""
import importlib.util
import os
from pathlib import Path
import shutil
import sys


def main():
    specification = importlib.util.spec_from_file_location('artdicohost_runtime', '/code/functions/fc-api/launch.py')
    decoder = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(decoder)
    runtime = decoder.prepare_runtime(Path('/code/runtime/node/bin/node.xz'))
    try:
        os.execv(str(runtime), [str(runtime), '/code/functions/cloud-content/server.mjs'])
    except BaseException:
        shutil.rmtree(runtime.parent)
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Cloud content runtime bootstrap verification failed.', file=sys.stderr)
        sys.exit(1)
