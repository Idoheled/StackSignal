import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('boundary_patch',Path(__file__).resolve().parents[1]/'bot/deploy/patch-whatsapp-boundary.py')
patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)

class BoundaryDeployment(unittest.TestCase):
 def test_unknown_pinned_source_is_refused_without_modifying_it(self):
  with tempfile.TemporaryDirectory() as root:
   path=Path(root)/'runtime.mjs';path.write_text('unreviewed source')
   with self.assertRaisesRegex(RuntimeError,'differs'):patch.patch(path)
   self.assertEqual(path.read_text(),'unreviewed source');self.assertEqual(len(list(Path(root).iterdir())),1)
 def test_idempotence_and_an_explicit_rollback_preserve_the_original(self):
  original='\t\tsyncFullHistory: false,\n\t\tfireInitQueries: receiveMode !== "directory",\n\tif (receiveMode === "directory") for (const event of [\n'
  pinned=patch.ORIGINAL_SHA256
  try:
   patch.ORIGINAL_SHA256=hashlib.sha256(original.encode()).hexdigest()
   with tempfile.TemporaryDirectory() as root:
    path=Path(root)/'runtime.mjs';path.write_text(original)
    self.assertTrue(patch.patch(path));installed=path.read_text()
    self.assertIn('shouldIgnoreJid',installed);self.assertIn('shouldSyncHistoryMessage',installed);self.assertIn('installColumbusBoundary',installed)
    self.assertFalse(patch.patch(path))
    path.write_text(original);self.assertTrue(patch.patch(path))
    path.write_text('unexpected change')
    with self.assertRaisesRegex(RuntimeError,'differs'):patch.patch(path)
  finally:patch.ORIGINAL_SHA256=pinned

if __name__=='__main__':unittest.main()
