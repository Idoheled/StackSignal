import importlib.util
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('delivery_config',Path(__file__).resolve().parents[1]/'bot/deploy/delivery-config.py')
config=importlib.util.module_from_spec(spec);spec.loader.exec_module(config)

class DeliveryConfiguration(unittest.TestCase):
    def test_existing_state_is_preserved_and_unsafe_transitions_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=root/'bot.env';db=root/'deliveries.sqlite'
            original='WHATSAPP_WEBHOOK_SECRET=synthetic-secret\nWHATSAPP_GROUP_JID=\nOLLAMA_MODEL=qwen3:4b\n'
            env.write_text(original);env.chmod(0o640)
            with sqlite3.connect(db) as connection:
                connection.execute('create table deliveries(phase text)')
                connection.execute("insert into deliveries values('queued')")
            with self.assertRaisesRegex(RuntimeError,'outstanding'):config.configure_delivery(env,db,'123456789@g.us')
            self.assertEqual(env.read_text(),original)
            with sqlite3.connect(db) as connection:connection.execute('delete from deliveries')
            with self.assertRaisesRegex(RuntimeError,'Invalid verified'):config.configure_delivery(env,db,'someone@s.whatsapp.net')
            self.assertFalse(config.configure_delivery(env,db,'123456789@g.us')['previously_configured'])
            self.assertEqual(env.stat().st_mode&0o777,0o640)
            self.assertIn('WHATSAPP_WEBHOOK_SECRET=synthetic-secret',env.read_text())
            self.assertTrue(config.configure_delivery(env,db,'123456789@g.us')['previously_configured'])
            with self.assertRaisesRegex(RuntimeError,'replace'):config.configure_delivery(env,db,'987654321@g.us')
            real=root/'real';env.rename(real);env.symlink_to(real)
            with self.assertRaisesRegex(RuntimeError,'runtime paths'):config.configure_delivery(env,db,'123456789@g.us')

if __name__=='__main__':unittest.main()
