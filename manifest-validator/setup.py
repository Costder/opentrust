"""Build hook that bundles the protocol schemas with manifest-validator."""

from pathlib import Path
from shutil import copy2

from setuptools import setup
from setuptools.command.build_py import build_py


class BuildPyWithSchemas(build_py):
    def run(self):
        super().run()
        source_dir = Path(__file__).resolve().parents[1] / "passport-schema"
        target_dir = Path(self.build_lib) / "manifest_validator" / "schemas"
        target_dir.mkdir(parents=True, exist_ok=True)
        for schema in source_dir.glob("*.schema.json"):
            copy2(schema, target_dir / schema.name)


setup(cmdclass={"build_py": BuildPyWithSchemas})
