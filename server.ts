import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./src/db/schema";
import { eq, and } from "drizzle-orm";
import cors from "cors";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";

const JWT_SECRET = "super-secret-siscopkbm";

// Setup multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

function initDatabase(sqlite: Database.Database) {
  // Ensure tables exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rombel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      program TEXT NOT NULL,
      level TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      nisn TEXT,
      nik TEXT,
      birth_date TEXT,
      address TEXT,
      program TEXT,
      rombel_id INTEGER REFERENCES rombel(id)
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      nip TEXT,
      specialization TEXT
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kkm INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rombel_id INTEGER REFERENCES rombel(id),
      subject_id INTEGER REFERENCES subjects(id),
      teacher_id INTEGER REFERENCES teachers(id),
      day TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      room TEXT DEFAULT 'Ruang Kelas',
      learning_type TEXT DEFAULT 'Tatap Muka',
      meeting_link TEXT,
      module_link TEXT,
      notes TEXT,
      is_published INTEGER DEFAULT 1,
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS learning_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER REFERENCES schedules(id),
      title TEXT NOT NULL,
      content TEXT,
      zoom_link TEXT,
      file_url TEXT
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER REFERENCES schedules(id),
      title TEXT NOT NULL,
      description TEXT,
      deadline TEXT
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER REFERENCES students(id),
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS academic_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER REFERENCES schedules(id),
      student_id INTEGER REFERENCES students(id),
      status TEXT NOT NULL,
      date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teacher_attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER REFERENCES schedules(id),
      teacher_id INTEGER REFERENCES teachers(id),
      status TEXT NOT NULL,
      date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER REFERENCES assignments(id),
      student_id INTEGER REFERENCES students(id),
      file_url TEXT,
      notes TEXT,
      submitted_at TEXT NOT NULL,
      score REAL,
      feedback TEXT,
      status TEXT DEFAULT 'Submitted'
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER REFERENCES invoices(id),
      student_id INTEGER REFERENCES students(id),
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      proof_url TEXT,
      paid_at TEXT NOT NULL,
      receipt_number TEXT,
      notes TEXT,
      status TEXT DEFAULT 'verified',
      verified_by TEXT,
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS invoice_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      default_amount REAL NOT NULL DEFAULT 0,
      description TEXT,
      program TEXT DEFAULT 'Semua Program',
      period_type TEXT DEFAULT 'Bulanan',
      is_active INTEGER DEFAULT 1,
      created_at TEXT
    );
  `);

  // Helper to add column if it doesn't exist (smooth schema migration)
  const addColumnIfNotExists = (table: string, column: string, typeDef: string) => {
    try {
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(c => c.name === column)) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
      }
    } catch (e) {
      console.error(`Error adding column ${column} to ${table}:`, e);
    }
  };

  // Run migrations
  addColumnIfNotExists('users', 'finance_access', "INTEGER DEFAULT 0");
  addColumnIfNotExists('users', 'rombel_access', "INTEGER DEFAULT 0");

  addColumnIfNotExists('rombel', 'academic_year', "TEXT DEFAULT '2026/2027 Ganjil'");
  addColumnIfNotExists('rombel', 'is_schedule_published', "INTEGER DEFAULT 1");
  addColumnIfNotExists('rombel', 'schedule_published_at', "TEXT");
  addColumnIfNotExists('rombel', 'schedule_publish_notes', "TEXT");

  addColumnIfNotExists('subjects', 'code', "TEXT");
  addColumnIfNotExists('subjects', 'category', "TEXT DEFAULT 'Umum'");
  addColumnIfNotExists('subjects', 'color', "TEXT DEFAULT 'emerald'");
  addColumnIfNotExists('subjects', 'hours_per_week', "INTEGER DEFAULT 2");
  addColumnIfNotExists('subjects', 'description', "TEXT");

  addColumnIfNotExists('schedules', 'room', "TEXT DEFAULT 'Ruang Kelas'");
  addColumnIfNotExists('schedules', 'learning_type', "TEXT DEFAULT 'Tatap Muka'");
  addColumnIfNotExists('schedules', 'meeting_link', "TEXT");
  addColumnIfNotExists('schedules', 'notes', "TEXT");
  addColumnIfNotExists('schedules', 'is_published', "INTEGER DEFAULT 1");
  addColumnIfNotExists('schedules', 'published_at', "TEXT");

  // Migrations for assignments
  addColumnIfNotExists('assignments', 'file_url', "TEXT");
  addColumnIfNotExists('assignments', 'max_score', "REAL DEFAULT 100");
  addColumnIfNotExists('assignments', 'created_at', "TEXT");

  // Migrations for assignment submissions
  addColumnIfNotExists('assignment_submissions', 'file_url', "TEXT");
  addColumnIfNotExists('assignment_submissions', 'notes', "TEXT");
  addColumnIfNotExists('assignment_submissions', 'submitted_at', "TEXT");
  addColumnIfNotExists('assignment_submissions', 'score', "REAL");
  addColumnIfNotExists('assignment_submissions', 'feedback', "TEXT");
  addColumnIfNotExists('assignment_submissions', 'status', "TEXT DEFAULT 'Submitted'");

  // Migrations for students
  addColumnIfNotExists('students', 'nis', "TEXT");

  // Backfill students NIS if missing
  try {
    sqlite.exec(`
      UPDATE students SET nis = '2401001' WHERE (nis IS NULL OR nis = '') AND id = 1;
      UPDATE students SET nis = '2401002' WHERE (nis IS NULL OR nis = '') AND id = 2;
      UPDATE students SET nis = '2401003' WHERE (nis IS NULL OR nis = '') AND id = 3;
      UPDATE students SET nis = '2401004' WHERE (nis IS NULL OR nis = '') AND id = 4;
      UPDATE students SET nis = '2401' || printf('%03d', id) WHERE (nis IS NULL OR nis = '');
    `);
  } catch (e) {
    console.error("Backfill students NIS error:", e);
  }

  // Migrations for invoices
  addColumnIfNotExists('invoices', 'category', "TEXT DEFAULT 'SPP Bulanan'");
  addColumnIfNotExists('invoices', 'items', "TEXT");
  addColumnIfNotExists('invoices', 'due_date', "TEXT");
  addColumnIfNotExists('invoices', 'paid_amount', "REAL DEFAULT 0");
  addColumnIfNotExists('invoices', 'paid_at', "TEXT");
  addColumnIfNotExists('invoices', 'payment_method', "TEXT");
  addColumnIfNotExists('invoices', 'payment_proof_url', "TEXT");
  addColumnIfNotExists('invoices', 'payment_notes', "TEXT");
  addColumnIfNotExists('invoices', 'receipt_number', "TEXT");
  addColumnIfNotExists('invoices', 'verified_by', "TEXT");

  // Backfill invoices receipt numbers & defaults
  try {
    sqlite.exec(`
      UPDATE invoices 
      SET receipt_number = 'KWT-' || strftime('%Y%m', 'now') || '-' || printf('%04d', id),
          paid_amount = amount,
          paid_at = created_at,
          payment_method = 'Transfer Bank (Verifikasi)',
          verified_by = 'Super Administrator'
      WHERE status = 'paid' AND (receipt_number IS NULL OR receipt_number = '');
      
      UPDATE invoices
      SET due_date = '2026-09-10'
      WHERE due_date IS NULL OR due_date = '';
    `);
  } catch (e) {
    console.error("Backfill invoices error:", e);
  }

  // Migrations for teacher attendances
  addColumnIfNotExists('teacher_attendances', 'check_in_time', "TEXT DEFAULT '08:00:00'");
  addColumnIfNotExists('teacher_attendances', 'teaching_journal', "TEXT");
  addColumnIfNotExists('teacher_attendances', 'learning_type', "TEXT DEFAULT 'Tatap Muka'");
  addColumnIfNotExists('teacher_attendances', 'proof_url', "TEXT");
  addColumnIfNotExists('teacher_attendances', 'notes', "TEXT");

  // Backfill sample journals if missing
  try {
    sqlite.exec(`
      UPDATE teacher_attendances 
      SET check_in_time = '08:15:00',
          learning_type = 'Tatap Muka',
          teaching_journal = 'Penyampaian materi pokok modul dan evaluasi pemahaman siswa'
      WHERE check_in_time IS NULL OR check_in_time = '';
    `);
  } catch (e) {
    console.error("Backfill teacher attendances error:", e);
  }

  // Backfill subjects data if code is null
  try {
    const existingSubs = sqlite.prepare("SELECT * FROM subjects").all() as any[];
    const colorList = ['emerald', 'blue', 'indigo', 'amber', 'rose', 'purple', 'cyan', 'teal'];
    const categoryMap: Record<string, { code: string; cat: string; color: string; hours: number }> = {
      'Bahasa Indonesia': { code: 'BIN-101', cat: 'Umum', color: 'blue', hours: 4 },
      'Matematika': { code: 'MAT-101', cat: 'Umum', color: 'emerald', hours: 4 },
      'Ilmu Pengetahuan Alam (IPA)': { code: 'IPA-101', cat: 'Umum', color: 'teal', hours: 4 },
      'Pendidikan Kewarganegaraan (PPKn)': { code: 'PKN-101', cat: 'Umum', color: 'rose', hours: 2 },
      'Bahasa Inggris': { code: 'ENG-101', cat: 'Umum', color: 'indigo', hours: 3 },
    };

    const updateSub = sqlite.prepare("UPDATE subjects SET code = ?, category = ?, color = ?, hours_per_week = ? WHERE id = ?");
    for (const sub of existingSubs) {
      if (!sub.code) {
        const meta = categoryMap[sub.name] || {
          code: `MPL-${sub.id}`,
          cat: 'Umum',
          color: colorList[sub.id % colorList.length],
          hours: 2
        };
        updateSub.run(meta.code, meta.cat, meta.color, meta.hours, sub.id);
      }
    }
  } catch (e) {
    console.error("Subject migration backfill error:", e);
  }

  // Seed default invoice categories if table is empty
  try {
    const catCount = sqlite.prepare("SELECT COUNT(*) as count FROM invoice_categories").get() as { count: number };
    if (catCount.count === 0) {
      const insertCat = sqlite.prepare(`
        INSERT INTO invoice_categories (name, default_amount, description, program, period_type, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      insertCat.run('SPP Bulanan', 150000, 'Iuran SPP Pembelajaran Bulanan PKBM', 'Semua Program', 'Bulanan', 1);
      insertCat.run('Uang Pangkal / DSP', 750000, 'Dana Sumbangan Pengembangan / Uang Gedung Siswa Baru', 'Semua Program', 'Sekali Bayar', 1);
      insertCat.run('Modul & Bahan Ajar', 200000, 'Paket Modul Kurikulum & Buku Panduan Belajar', 'Semua Program', 'Tahunan', 1);
      insertCat.run('Ujian & Evaluasi Akhir', 250000, 'Biaya Ujian Kesetaraan, Asesmen & Ujian Akhir', 'Semua Program', 'Sekali Bayar', 1);
      insertCat.run('Pendaftaran & Administrasi', 100000, 'Biaya registrasi & verifikasi berkas awal calon siswa', 'Semua Program', 'Sekali Bayar', 1);
      insertCat.run('Pelatihan Vokasi & Keterampilan', 175000, 'Pelatihan keterampilan vokasi & wirausaha mandiri', 'Semua Program', 'Insidental', 1);
    }
  } catch (e) {
    console.error("Invoice categories seeding error:", e);
  }

  // Ensure default bendahara user exists if database already initialized
  try {
    const bendaharaCheck = sqlite.prepare("SELECT id FROM users WHERE role = 'bendahara' LIMIT 1").get();
    if (!bendaharaCheck) {
      sqlite.prepare("INSERT INTO users (username, password, role, name, finance_access) VALUES (?, ?, ?, ?, 1)").run(
        'bendahara', 'bendahara123', 'bendahara', 'Siti Aminah, S.E. (Bendahara)'
      );
    }
  } catch (e) {
    console.error("Bendahara seed check error:", e);
  }

  // Seed default data if superadmin doesn't exist (means main seed hasn't run)
  const superadminCheck = sqlite.prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1").get();
  if (!superadminCheck) {
    const insertUser = sqlite.prepare("INSERT INTO users (username, password, role, name, finance_access) VALUES (?, ?, ?, ?, ?)");
    
    const superadminId = insertUser.run('superadmin', 'admin123', 'superadmin', 'Super Administrator', 1).lastInsertRowid;
    const adminId = insertUser.run('admin', 'admin123', 'admin', 'Staf Administrasi TU', 0).lastInsertRowid;
    // bendahara already handled by the check above, but we might insert it again if the check above didn't exist. Actually, let's safely insert others if they don't exist.
    const guruId1 = insertUser.run('guru', 'guru123', 'guru', 'Budi Santoso, S.Pd.', 0).lastInsertRowid;
    const guruId2 = insertUser.run('guru2', 'guru123', 'guru', 'Siti Rahmawati, M.Pd.', 0).lastInsertRowid;
    const siswaId1 = insertUser.run('siswa', 'siswa123', 'siswa', 'Ahmad Fauzi', 0).lastInsertRowid;
    const siswaId2 = insertUser.run('siswa2', 'siswa123', 'siswa', 'Dewi Lestari', 0).lastInsertRowid;
    const siswaId3 = insertUser.run('siswa3', 'siswa123', 'siswa', 'Rian Pratama', 0).lastInsertRowid;
    const siswaId4 = insertUser.run('siswa4', 'siswa123', 'siswa', 'Nur Hidayah', 0).lastInsertRowid;

    // Seed Rombels
    const insertRombel = sqlite.prepare("INSERT INTO rombel (name, program, level) VALUES (?, ?, ?)");
    const r1 = insertRombel.run('Paket A - Kelas 5', 'Paket A', 'Kelas 5').lastInsertRowid;
    const r2 = insertRombel.run('Paket A - Kelas 6', 'Paket A', 'Kelas 6').lastInsertRowid;
    const r3 = insertRombel.run('Paket B - Kelas 7', 'Paket B', 'Kelas 7').lastInsertRowid;
    const r4 = insertRombel.run('Paket B - Kelas 8', 'Paket B', 'Kelas 8').lastInsertRowid;
    const r5 = insertRombel.run('Paket B - Kelas 9', 'Paket B', 'Kelas 9').lastInsertRowid;
    const r6 = insertRombel.run('Paket C - Kelas 10', 'Paket C', 'Kelas 10').lastInsertRowid;
    const r7 = insertRombel.run('Paket C - Kelas 11 IPA', 'Paket C', 'Kelas 11').lastInsertRowid;
    const r8 = insertRombel.run('Paket C - Kelas 12 IPS', 'Paket C', 'Kelas 12').lastInsertRowid;

    // Seed Teachers
    const insertTeacher = sqlite.prepare("INSERT INTO teachers (user_id, nip, specialization) VALUES (?, ?, ?)");
    const t1 = insertTeacher.run(guruId1, '198501152010011005', 'Matematika & IPA').lastInsertRowid;
    const t2 = insertTeacher.run(guruId2, '199008202015022003', 'Bahasa Indonesia & PPKn').lastInsertRowid;

    // Seed Students
    const insertStudent = sqlite.prepare("INSERT INTO students (user_id, nis, nisn, nik, birth_date, address, program, rombel_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const s1 = insertStudent.run(siswaId1, '2401001', '0081234567', '3171010101000001', '2008-04-12', 'Jl. Merdeka No. 10, Jakarta', 'Paket C', r8).lastInsertRowid;
    const s2 = insertStudent.run(siswaId2, '2401002', '0092345678', '3171010101000002', '2009-08-25', 'Jl. Melati No. 4, Jakarta', 'Paket C', r8).lastInsertRowid;
    const s3 = insertStudent.run(siswaId3, '2401003', '0103456789', '3171010101000003', '2010-02-18', 'Jl. Mawar No. 12, Jakarta', 'Paket B', r5).lastInsertRowid;
    const s4 = insertStudent.run(siswaId4, '2401004', '0124567890', '3171010101000004', '2012-11-05', 'Jl. Kenanga No. 7, Jakarta', 'Paket A', r2).lastInsertRowid;

    // Seed Subjects
    const insertSubject = sqlite.prepare("INSERT INTO subjects (name, kkm) VALUES (?, ?)");
    const sub1 = insertSubject.run('Bahasa Indonesia', 75).lastInsertRowid;
    const sub2 = insertSubject.run('Matematika', 70).lastInsertRowid;
    const sub3 = insertSubject.run('Ilmu Pengetahuan Alam (IPA)', 72).lastInsertRowid;
    const sub4 = insertSubject.run('Pendidikan Kewarganegaraan (PPKn)', 75).lastInsertRowid;
    const sub5 = insertSubject.run('Bahasa Inggris', 70).lastInsertRowid;

    // Seed Schedules
    const insertSchedule = sqlite.prepare("INSERT INTO schedules (rombel_id, subject_id, teacher_id, day, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)");
    const sch1 = insertSchedule.run(r8, sub1, t2, 'Senin', '08:00', '10:00').lastInsertRowid;
    const sch2 = insertSchedule.run(r8, sub2, t1, 'Senin', '10:15', '12:15').lastInsertRowid;
    const sch3 = insertSchedule.run(r5, sub3, t1, 'Selasa', '08:00', '10:00').lastInsertRowid;
    const sch4 = insertSchedule.run(r2, sub4, t2, 'Rabu', '08:00', '09:30').lastInsertRowid;

    // Seed Invoices
    const insertInvoice = sqlite.prepare("INSERT INTO invoices (student_id, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?)");
    insertInvoice.run(s1, 250000, 'Biaya Pendaftaran Paket C', 'paid', new Date().toISOString());
    insertInvoice.run(s1, 150000, 'SPP Bulan Agustus 2026', 'pending', new Date().toISOString());
    insertInvoice.run(s2, 250000, 'Biaya Pendaftaran Paket C', 'paid', new Date().toISOString());
    insertInvoice.run(s3, 200000, 'Biaya Pendaftaran Paket B', 'pending', new Date().toISOString());
    insertInvoice.run(s4, 150000, 'Biaya Pendaftaran Paket A', 'paid', new Date().toISOString());

    // Seed Learning Materials
    const insertMaterial = sqlite.prepare("INSERT INTO learning_materials (schedule_id, title, content, zoom_link, file_url) VALUES (?, ?, ?, ?, ?)");
    insertMaterial.run(sch1, 'Modul 1: Memahami Teks Eksplanasi', 'Materi pengantar untuk memahami struktur dan kaidah kebahasaan teks eksplanasi pada kehidupan sehari-hari.', 'https://zoom.us/j/123456789', '');
    insertMaterial.run(sch2, 'Modul 1: Konsep Aljabar Linier', 'Pembahasan dasar persamaan aljabar linear dua variabel beserta contoh soal aplikatif.', '', '');

    // Seed Teacher Attendances with multi-month data for trend analysis
    const insertTeacherAtt = sqlite.prepare("INSERT INTO teacher_attendances (schedule_id, teacher_id, status, date) VALUES (?, ?, ?, ?)");
    const attSample = [
      // Maret 2026
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-03-02' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-03-02' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-03-03' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-03-04' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-03-09' },
      { sch: sch2, t: t1, status: 'Izin', date: '2026-03-09' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-03-10' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-03-11' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-03-16' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-03-16' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-03-17' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-03-18' },
      // April 2026
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-04-06' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-04-06' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-04-07' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-04-08' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-04-13' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-04-13' },
      { sch: sch3, t: t1, status: 'Sakit', date: '2026-04-14' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-04-15' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-04-20' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-04-20' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-04-21' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-04-22' },
      // Mei 2026
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-05-04' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-05-04' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-05-05' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-05-06' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-05-11' },
      { sch: sch2, t: t1, status: 'Izin', date: '2026-05-11' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-05-12' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-05-13' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-05-18' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-05-18' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-05-19' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-05-20' },
      // Juni 2026
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-06-01' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-06-01' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-06-02' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-06-03' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-06-08' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-06-08' },
      { sch: sch3, t: t1, status: 'Sakit', date: '2026-06-09' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-06-10' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-06-15' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-06-15' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-06-16' },
      { sch: sch4, t: t2, status: 'Izin', date: '2026-06-17' },
      // Juli 2026
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-07-06' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-07-06' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-07-07' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-07-08' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-07-13' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-07-13' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-07-14' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-07-15' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-07-20' },
      { sch: sch2, t: t1, status: 'Sakit', date: '2026-07-20' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-07-21' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-07-22' },
      // Agustus 2026 (Minggu 1: 03-09 Agu)
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-08-03' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-08-03' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-08-04' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-08-05' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-08-07' },
      // Agustus 2026 (Minggu 2: 10-16 Agu)
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-08-10' },
      { sch: sch2, t: t1, status: 'Izin', date: '2026-08-10' },
      { sch: sch3, t: t1, status: 'Hadir', date: '2026-08-11' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-08-12' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-08-14' },
      // Agustus 2026 (Minggu 3: 17-23 Agu - Minggu Ini)
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-08-17' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-08-17' },
      { sch: sch3, t: t1, status: 'Sakit', date: '2026-08-18' },
      { sch: sch4, t: t2, status: 'Hadir', date: '2026-08-19' },
      { sch: sch1, t: t2, status: 'Hadir', date: '2026-08-20' },
      { sch: sch2, t: t1, status: 'Hadir', date: '2026-08-20' },
    ];
    attSample.forEach(a => insertTeacherAtt.run(a.sch, a.t, a.status, a.date));

    // Seed Site Settings
    const insertSetting = sqlite.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?)");
    insertSetting.run('app_name', 'SISCO AL-ABROR');
    insertSetting.run('app_logo', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Tut_Wuri_Handayani.svg/200px-Tut_Wuri_Handayani.svg.png');
    insertSetting.run('hero_title', 'Pendidikan Kesetaraan Berkualitas & Fleksibel');
    insertSetting.run('hero_subtitle', 'PKBM AL-ABROR menyediakan program pendidikan kesetaraan Paket A, B, dan C dengan kurikulum terpadu dan fasilitas e-learning modern.');
    insertSetting.run('about_title', 'Tentang PKBM AL-ABROR');
    insertSetting.run('about_description', 'PKBM AL-ABROR adalah lembaga pendidikan non-formal yang menyelenggarakan program kesetaraan untuk memberikan akses pendidikan yang luas, berkualitas, dan relevan dengan kebutuhan masyarakat modern.');
    insertSetting.run('youtube_link', 'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&controls=1&showinfo=0');
    insertSetting.run('hero_badge', 'Penerimaan Peserta Didik Baru Tahun Ajaran 2024/2025 Dibuka');
    insertSetting.run('stat_1_value', '500+');
    insertSetting.run('stat_1_label', 'Lulusan');
    insertSetting.run('stat_2_value', '50+');
    insertSetting.run('stat_2_label', 'Tutor Profesional');
    insertSetting.run('stat_3_value', '10+');
    insertSetting.run('stat_3_label', 'Mitra Kerja');
    insertSetting.run('headmaster_photo', 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=2070&auto=format&fit=crop');
    insertSetting.run('headmaster_name', 'Dr. H. Ahmad Fauzi, M.Pd');
    insertSetting.run('headmaster_role', 'Kepala Sekolah');
    insertSetting.run('headmaster_quote', '"Pendidikan adalah hak setiap warga negara. Melalui wadah ini, kami berkomitmen untuk melahirkan generasi yang tidak hanya setara secara akademik, namun unggul dalam karakter, kemandirian, dan keterampilan hidup untuk masa depan yang lebih baik."');
    insertSetting.run('vision_text', 'Menjadi pusat pembelajaran unggul yang mencetak lulusan kompeten, berakhlak mulia, dan siap bersaing di dunia kerja.');
    insertSetting.run('mission_text', 'Menyelenggarakan pendidikan adaptif dengan tutor profesional, fasilitas e-learning modern, dan kurikulum yang diakui secara nasional.');
    insertSetting.run('contact_email', 'info@alabror.ac.id');
    insertSetting.run('contact_phone', '+62 811 2345 6789');
    insertSetting.run('contact_address', 'Jl. Pendidikan No. 123, Jakarta');
    insertSetting.run('gallery_image_1', 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=2071&auto=format&fit=crop');
    insertSetting.run('gallery_image_2', 'https://images.unsplash.com/photo-1577896851231-70ef18881754?q=80&w=2071&auto=format&fit=crop');
    insertSetting.run('gallery_image_3', 'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?q=80&w=2071&auto=format&fit=crop');
  }

  // Ensure diverse subjects and schedules across programs if count is low
  try {
    const subCount = sqlite.prepare("SELECT COUNT(*) as count FROM subjects").get() as { count: number };
    if (subCount.count < 8) {
      const insertSub = sqlite.prepare("INSERT INTO subjects (name, kkm, code, category, color, hours_per_week, description) VALUES (?, ?, ?, ?, ?, ?, ?)");
      insertSub.run('Keterampilan Komputer & Digital', 75, 'VOK-101', 'Keterampilan/Vokasi', 'cyan', 4, 'Penguasaan aplikasi perkantoran, desain grafis Canva/Photoshop, dan literasi digital praktis.');
      insertSub.run('Pemberdayaan & Kewirausahaan', 75, 'PBD-101', 'Pemberdayaan', 'amber', 3, 'Manajemen usaha mandiri, pemasaran produk lokal, dan perencanaan keuangan UMKM.');
      insertSub.run('Sejarah Kebudayaan & IPS', 72, 'IPS-101', 'Umum', 'purple', 3, 'Pemahaman dinamika sejarah nasional, geografi nusantara, dan sosiologi kemasyarakatan.');
    }

    const schCount = sqlite.prepare("SELECT COUNT(*) as count FROM schedules").get() as { count: number };
    if (schCount.count < 12) {
      const rombels = sqlite.prepare("SELECT * FROM rombel").all() as any[];
      const teachers = sqlite.prepare("SELECT * FROM teachers").all() as any[];
      const subjects = sqlite.prepare("SELECT * FROM subjects").all() as any[];

      if (rombels.length > 0 && teachers.length >= 2 && subjects.length >= 4) {
        const insertSch = sqlite.prepare(`
          INSERT INTO schedules (rombel_id, subject_id, teacher_id, day, start_time, end_time, room, learning_type, meeting_link, notes, is_published, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
        `);

        // Additional schedules for Paket C - Kelas 12 IPS (r8)
        const r8 = rombels.find(r => r.name.includes('12 IPS')) || rombels[0];
        const r7 = rombels.find(r => r.name.includes('11 IPA')) || rombels[0];
        const r5 = rombels.find(r => r.name.includes('Kelas 9')) || rombels[0];
        const r2 = rombels.find(r => r.name.includes('Kelas 6')) || rombels[0];

        const t1 = teachers[0].id;
        const t2 = teachers[1].id;

        const subKomputer = subjects.find(s => s.name.includes('Komputer'))?.id || subjects[0].id;
        const subWirausaha = subjects.find(s => s.name.includes('Wirausaha'))?.id || subjects[1].id;
        const subInggris = subjects.find(s => s.name.includes('Inggris'))?.id || subjects[2].id;
        const subIPA = subjects.find(s => s.name.includes('IPA'))?.id || subjects[0].id;
        const subBIndo = subjects.find(s => s.name.includes('Bahasa Indonesia'))?.id || subjects[1].id;
        const subMTK = subjects.find(s => s.name.includes('Matematika'))?.id || subjects[0].id;

        // Schedule items with rooms and learning types
        insertSch.run(r8.id, subInggris, t1, 'Selasa', '08:00', '09:30', 'Ruang Kelas 12', 'Tatap Muka', '', 'Fokus percakapan bahasa Inggris bisnis & korespondensi');
        insertSch.run(r8.id, subKomputer, t2, 'Rabu', '08:00', '10:00', 'Lab Komputer 1', 'Praktik Vokasi', '', 'Praktik desain grafis materi promosi produk');
        insertSch.run(r8.id, subWirausaha, t1, 'Kamis', '10:00', '12:00', 'Ruang Praktik UMKM', 'Tatap Muka', '', 'Presentasi rencana bisnis mandiri kelompok');
        
        // Schedules for Paket C Kelas 11 IPA
        insertSch.run(r7.id, subMTK, t1, 'Senin', '08:00', '10:00', 'Ruang Kelas 11', 'Tatap Muka', '', 'Persamaan Kuadrat & Matriks Lanjutan');
        insertSch.run(r7.id, subIPA, t1, 'Rabu', '10:15', '12:15', 'Lab IPA Terpadu', 'Praktik Vokasi', '', 'Eksperimen Termodinamika & Reaksi Redoks');
        insertSch.run(r7.id, subBIndo, t2, 'Jumat', '08:00', '09:30', 'Ruang Kelas 11', 'Daring (Online)', 'https://zoom.us/j/987654321', 'Kajian karya sastra dan resensi buku');

        // Schedules for Paket B Kelas 9
        insertSch.run(r5.id, subBIndo, t2, 'Senin', '10:15', '12:00', 'Ruang Kelas 9', 'Tatap Muka', '', 'Tata bahasa baku dan teks persuasi');
        insertSch.run(r5.id, subKomputer, t1, 'Kamis', '08:00', '09:45', 'Lab Komputer 1', 'Praktik Vokasi', '', 'Pengenalan Microsoft Excel dan Google Sheets');

        // Schedules for Paket A Kelas 6
        insertSch.run(r2.id, subMTK, t1, 'Senin', '08:00', '09:30', 'Ruang Kelas 6', 'Tatap Muka', '', 'Pecahan desimal dan geometri dasar');
        insertSch.run(r2.id, subIPA, t2, 'Kamis', '08:00', '09:30', 'Ruang Kelas 6', 'Tatap Muka', '', 'Ekosistem dan pelestarian lingkungan hidup');
      }
    }

    // Seed assignments & submissions if empty
    const assCount = sqlite.prepare("SELECT COUNT(*) as count FROM assignments").get() as { count: number };
    if (assCount.count === 0) {
      const schList = sqlite.prepare("SELECT * FROM schedules").all() as any[];
      const studentList = sqlite.prepare("SELECT * FROM students").all() as any[];
      if (schList.length > 0) {
        const insertAss = sqlite.prepare(`
          INSERT INTO assignments (schedule_id, title, description, deadline, max_score, created_at, file_url)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        // Tugas 1 for Schedule 1 (Paket C Kelas 12 IPS - Bahasa Indonesia)
        const a1 = insertAss.run(
          schList[0].id,
          'Tugas 1: Analisis Struktur Teks Eksplanasi & Ringkasan Artikel',
          'Bacalah teks eksplanasi pada modul 1 bab 2. Tuliskan analisis struktur teks (Pernyataan Umum, Rangkaian Penjelasan Kausal, dan Interpretasi/Kesimpulan) serta buat ringkasan 2 paragraf menggunakan kosakata baku bahasa Indonesia. Unggah dalam format berkas PDF atau Foto lembar kerja pengerjaan Anda.',
          '2026-08-30T23:59',
          100,
          '2026-08-20 08:30:00',
          ''
        ).lastInsertRowid;

        // Tugas 2 for Schedule 2 if available
        if (schList.length > 1) {
          insertAss.run(
            schList[1].id,
            'Tugas Mandiri 1: Pemodelan Sistem Persamaan Linier Dua Variabel (SPLDV)',
            'Kerjakan 5 soal latihan kasus nyata ekonomi keluarga yang dapat dimodelkan menggunakan sistem persamaan linear dua variabel pada modul aljabar. Uraikan setiap langkah penyelesaian aljabar secara runtut dan teliti.',
            '2026-08-31T23:59',
            100,
            '2026-08-21 10:15:00',
            ''
          );
        }

        // Tugas 3 for Schedule 3 if available
        if (schList.length > 2) {
          insertAss.run(
            schList[2].id,
            'Proyek Mandiri: Laporan Observasi Konservasi Sumber Daya Alam di Rumah',
            'Lakukan pengamatan pola penggunaan dan penghematan air serta energi listrik di tempat tinggal Anda selama 3 hari. Buat catatan pengamatan dan kesimpulan langkah konservasi ramah lingkungan.',
            '2026-09-02T23:59',
            100,
            '2026-08-22 09:00:00',
            ''
          );
        }

        // Sample submission from first student for Tugas 1
        if (studentList.length > 0) {
          const insertSubm = sqlite.prepare(`
            INSERT INTO assignment_submissions (assignment_id, student_id, file_url, notes, submitted_at, score, feedback, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          insertSubm.run(
            a1,
            studentList[0].id,
            '',
            'Yth. Ibu Guru, berikut tugas analisis struktur teks eksplanasi fenomena siklus hidrologi dan pembentukan pelangi beserta ringkasan 2 paragraf telah saya selesaikan sesuai panduan modul pembelajaran.',
            '2026-08-22 15:30:45',
            92,
            'Analisis struktur sangat baik dan runtut, kaidah kebahasaan baku dipatuhi dengan sangat baik. Pertahankan semangat belajar!',
            'Graded'
          );
        }
      }
    }
  } catch (e) {
    console.error("Error expanding seed schedules:", e);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  const sqlite = new Database("sqlite.db");
  sqlite.pragma('foreign_keys = ON');
  initDatabase(sqlite);

  const db = drizzle(sqlite, { schema });

  // Auth Route
  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
      
      if (user.length === 0 || user[0].password !== password) {
        return res.status(401).json({ error: "Username atau kata sandi tidak valid." });
      }

      const financeAccess = Boolean(user[0].financeAccess) || user[0].role === 'superadmin' || user[0].role === 'bendahara';
      const rombelAccess = user[0].role === 'superadmin' || user[0].role === 'admin' || Boolean(user[0].rombelAccess);

      const token = jwt.sign({ 
        id: user[0].id, 
        role: user[0].role, 
        name: user[0].name,
        financeAccess,
        rombelAccess
      }, JWT_SECRET, { expiresIn: '1d' });

      res.json({ 
        token, 
        user: { 
          id: user[0].id, 
          role: user[0].role, 
          name: user[0].name, 
          username: user[0].username,
          financeAccess,
          rombelAccess
        } 
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Middleware to verify token
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // SPMB Registration (Public)
  app.post("/api/register", async (req, res) => {
    try {
      const { name, nik, nisn, birthDate, program, phone } = req.body;
      
      const newUser = await db.insert(schema.users).values({
        username: nik || `siswa_${Date.now()}`,
        password: 'password123',
        role: 'siswa',
        name: name
      }).returning();

      const userId = newUser[0].id;

      const newStudent = await db.insert(schema.students).values({
        userId,
        nisn: nisn || '',
        nik: nik || '',
        birthDate: birthDate || '',
        program: program || 'Paket C'
      }).returning();

      await db.insert(schema.invoices).values({
        studentId: newStudent[0].id,
        amount: 250000,
        description: `Biaya Pendaftaran - ${program || 'Paket C'}`,
        status: 'pending',
        category: 'Pendaftaran',
        dueDate: '2026-09-15',
        createdAt: new Date().toISOString()
      });

      res.json({ success: true, message: "Pendaftaran berhasil, invoice telah dibuat." });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/me", authenticateToken, async (req: any, res: any) => {
    try {
      const u = await db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).limit(1);
      if (u.length > 0) {
        const financeAccess = Boolean(u[0].financeAccess) || u[0].role === 'superadmin' || u[0].role === 'bendahara';
        const rombelAccess = u[0].role === 'superadmin' || u[0].role === 'admin' || Boolean(u[0].rombelAccess);
        return res.json({
          id: u[0].id,
          role: u[0].role,
          name: u[0].name,
          username: u[0].username,
          financeAccess,
          rombelAccess
        });
      }
      res.json(req.user);
    } catch (e: any) {
      res.json(req.user);
    }
  });

  // Master Data: Students
  app.get("/api/students", authenticateToken, async (req, res) => {
    try {
      const students = await db.select({
        id: schema.students.id,
        nis: schema.students.nis,
        nisn: schema.students.nisn,
        nik: schema.students.nik,
        program: schema.students.program,
        rombelId: schema.students.rombelId,
        address: schema.students.address,
        birthDate: schema.students.birthDate,
        name: schema.users.name,
        rombelName: schema.rombel.name,
        rombelLevel: schema.rombel.level,
      }).from(schema.students)
        .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
        .leftJoin(schema.rombel, eq(schema.students.rombelId, schema.rombel.id));
      res.json(students);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/students", authenticateToken, async (req: any, res: any) => {
    try {
      const { name, nis, nisn, nik, program, rombelId, address, birthDate } = req.body;
      const username = `siswa_${Math.floor(Math.random() * 100000)}`;
      const newUser = await db.insert(schema.users).values({
        username,
        password: 'password123',
        role: 'siswa',
        name: name
      }).returning();

      const newStudent = await db.insert(schema.students).values({
        userId: newUser[0].id,
        nis: nis || `2401${Math.floor(100 + Math.random() * 900)}`,
        nisn: nisn || '',
        nik: nik || '',
        birthDate: birthDate || '',
        address: address || '',
        program: program || 'Paket C',
        rombelId: rombelId ? parseInt(rombelId) : null
      }).returning();

      res.json({ success: true, student: newStudent[0] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/students/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const studentId = parseInt(req.params.id);
      const { name, nis, nisn, nik, program, rombelId, address, birthDate } = req.body;
      
      const currentStudent = await db.select().from(schema.students).where(eq(schema.students.id, studentId)).limit(1);
      if (currentStudent.length === 0) return res.status(404).json({ error: "Siswa tidak ditemukan" });

      if (name && currentStudent[0].userId) {
        await db.update(schema.users).set({ name }).where(eq(schema.users.id, currentStudent[0].userId));
      }

      await db.update(schema.students).set({
        nis: nis !== undefined ? nis : currentStudent[0].nis,
        nisn: nisn !== undefined ? nisn : currentStudent[0].nisn,
        nik: nik !== undefined ? nik : currentStudent[0].nik,
        birthDate: birthDate !== undefined ? birthDate : currentStudent[0].birthDate,
        address: address !== undefined ? address : currentStudent[0].address,
        program: program !== undefined ? program : currentStudent[0].program,
        rombelId: rombelId !== undefined ? (rombelId ? parseInt(rombelId) : null) : currentStudent[0].rombelId,
      }).where(eq(schema.students.id, studentId));

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Helper to check rombel manage authorization (Superadmin, Admin, or Bendahara with special permission)
  const canUserManageRombel = async (reqUser: any) => {
    if (!reqUser) return false;
    if (reqUser.role === 'superadmin' || reqUser.role === 'admin') return true;
    if (reqUser.role === 'bendahara') {
      const u = await db.select().from(schema.users).where(eq(schema.users.id, reqUser.id)).limit(1);
      return u.length > 0 && Boolean(u[0].rombelAccess);
    }
    return false;
  };

  // Assign Student to Rombel
  app.put("/api/students/:id/rombel", authenticateToken, async (req: any, res: any) => {
    try {
      const isAllowed = await canUserManageRombel(req.user);
      if (!isAllowed) {
        return res.status(403).json({ 
          error: "Akses Ditolak: Bendahara tidak diizinkan mengubah rombel kecuali mendapatkan izin dari Superadmin." 
        });
      }

      const studentId = parseInt(req.params.id);
      const { rombelId } = req.body;
      await db.update(schema.students).set({
        rombelId: rombelId ? parseInt(rombelId) : null
      }).where(eq(schema.students.id, studentId));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Master Data: Teachers
  app.get("/api/teachers", authenticateToken, async (req, res) => {
    try {
      const teachers = await db.select({
        id: schema.teachers.id,
        nip: schema.teachers.nip,
        specialization: schema.teachers.specialization,
        name: schema.users.name,
      }).from(schema.teachers)
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id));
      res.json(teachers);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/teachers", authenticateToken, async (req: any, res: any) => {
    try {
      const { name, nip, specialization } = req.body;
      const username = `guru_${Math.floor(Math.random() * 100000)}`;
      const newUser = await db.insert(schema.users).values({
        username,
        password: 'password123',
        role: 'guru',
        name: name
      }).returning();

      const newTeacher = await db.insert(schema.teachers).values({
        userId: newUser[0].id,
        nip,
        specialization
      }).returning();

      res.json({ success: true, teacher: newTeacher[0] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== ROMBEL (Rombongan Belajar) CRUD ====================
  app.get("/api/rombels", authenticateToken, async (req: any, res: any) => {
    try {
      const rombels = await db.select().from(schema.rombel);
      const students = await db.select().from(schema.students);
      
      const rombelWithCounts = rombels.map(r => {
        const studentCount = students.filter(s => s.rombelId === r.id).length;
        return {
          ...r,
          studentCount
        };
      });

      res.json(rombelWithCounts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/rombels", authenticateToken, async (req: any, res: any) => {
    try {
      const isAllowed = await canUserManageRombel(req.user);
      if (!isAllowed) {
        return res.status(403).json({ 
          error: "Akses Ditolak: Bendahara tidak diizinkan menambah atau mengubah rombel. Tambah rombel hanya dimiliki oleh Superadmin dan Admin kecuali mendapatkan izin dari Superadmin." 
        });
      }

      const { name, program, level } = req.body;
      if (!name || !program || !level) {
        return res.status(400).json({ error: "Nama kelas, program, dan tingkatan wajib diisi." });
      }
      const newRombel = await db.insert(schema.rombel).values({
        name,
        program,
        level
      }).returning();
      res.json({ success: true, rombel: newRombel[0] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/rombels/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const isAllowed = await canUserManageRombel(req.user);
      if (!isAllowed) {
        return res.status(403).json({ 
          error: "Akses Ditolak: Bendahara tidak diizinkan menambah atau mengubah rombel. Pengubahan rombel hanya dimiliki oleh Superadmin dan Admin kecuali mendapatkan izin dari Superadmin." 
        });
      }

      const id = parseInt(req.params.id);
      const { name, program, level } = req.body;
      if (!name || !program || !level) {
        return res.status(400).json({ error: "Nama kelas, program, dan tingkatan wajib diisi." });
      }
      await db.update(schema.rombel).set({
        name,
        program,
        level
      }).where(eq(schema.rombel.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/rombels/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const isAllowed = await canUserManageRombel(req.user);
      if (!isAllowed) {
        return res.status(403).json({ 
          error: "Akses Ditolak: Penghapusan rombel hanya dimiliki oleh Superadmin dan Admin kecuali mendapatkan izin dari Superadmin." 
        });
      }

      const id = parseInt(req.params.id);
      // Unassign students from this rombel
      await db.update(schema.students).set({ rombelId: null }).where(eq(schema.students.rombelId, id));
      // Delete schedules associated with this rombel
      await db.delete(schema.schedules).where(eq(schema.schedules.rombelId, id));
      // Delete rombel
      await db.delete(schema.rombel).where(eq(schema.rombel.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Students by Rombel
  app.get("/api/rombels/:id/students", authenticateToken, async (req: any, res: any) => {
    try {
      const rombelId = parseInt(req.params.id);
      const studentsInRombel = await db.select({
        id: schema.students.id,
        nisn: schema.students.nisn,
        nik: schema.students.nik,
        program: schema.students.program,
        name: schema.users.name,
      }).from(schema.students)
        .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
        .where(eq(schema.students.rombelId, rombelId));
      res.json(studentsInRombel);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Batch Assign/Remove Students to/from Rombel
  app.post("/api/rombels/:id/students", authenticateToken, async (req: any, res: any) => {
    try {
      const isAllowed = await canUserManageRombel(req.user);
      if (!isAllowed) {
        return res.status(403).json({ 
          error: "Akses Ditolak: Anda tidak memiliki izin untuk mengalokasikan siswa ke rombel." 
        });
      }

      const rombelId = parseInt(req.params.id);
      const { studentIds } = req.body; // array of student ids
      if (Array.isArray(studentIds)) {
        for (const sId of studentIds) {
          await db.update(schema.students).set({ rombelId }).where(eq(schema.students.id, sId));
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/rombels/:id/students/:studentId", authenticateToken, async (req: any, res: any) => {
    try {
      const isAllowed = await canUserManageRombel(req.user);
      if (!isAllowed) {
        return res.status(403).json({ 
          error: "Akses Ditolak: Anda tidak memiliki izin untuk mengeluarkan siswa dari rombel." 
        });
      }

      const studentId = parseInt(req.params.studentId);
      await db.update(schema.students).set({ rombelId: null }).where(eq(schema.students.id, studentId));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Akademik: Subjects CRUD & Customization
  app.get("/api/subjects", authenticateToken, async (req, res) => {
    try {
      const subjects = await db.select().from(schema.subjects);
      res.json(subjects);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/subjects", authenticateToken, async (req: any, res: any) => {
    try {
      const { name, kkm, code, category, color, hoursPerWeek, description } = req.body;
      if (!name || kkm === undefined) {
        return res.status(400).json({ error: "Nama mata pelajaran dan KKM wajib diisi." });
      }
      const result = await db.insert(schema.subjects).values({
        name,
        kkm: parseInt(kkm),
        code: code || `MPL-${Math.floor(100 + Math.random() * 900)}`,
        category: category || 'Umum',
        color: color || 'emerald',
        hoursPerWeek: hoursPerWeek ? parseInt(hoursPerWeek) : 2,
        description: description || ''
      }).returning();
      res.json({ success: true, subject: result[0] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/subjects/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const { name, kkm, code, category, color, hoursPerWeek, description } = req.body;
      await db.update(schema.subjects).set({
        name,
        kkm: parseInt(kkm),
        code: code || `MPL-${id}`,
        category: category || 'Umum',
        color: color || 'emerald',
        hoursPerWeek: hoursPerWeek ? parseInt(hoursPerWeek) : 2,
        description: description || ''
      }).where(eq(schema.subjects.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/subjects/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      // Check if subject is used in schedules
      const usedSchedules = await db.select().from(schema.schedules).where(eq(schema.schedules.subjectId, id));
      if (usedSchedules.length > 0) {
        return res.status(400).json({
          error: `Mata pelajaran tidak dapat dihapus karena masih digunakan dalam ${usedSchedules.length} jadwal pelajaran. Silakan hapus jadwal terkait terlebih dahulu.`
        });
      }
      await db.delete(schema.subjects).where(eq(schema.subjects.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== HELPER: TERBILANG RUPIAH ====================
  function numberToTerbilang(angka: number): string {
    const bilangan = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];
    const n = Math.floor(Math.abs(angka));
    if (n < 12) return bilangan[n];
    if (n < 20) return `${numberToTerbilang(n - 10)} Belas`;
    if (n < 100) return `${numberToTerbilang(Math.floor(n / 10))} Puluh ${numberToTerbilang(n % 10)}`.trim();
    if (n < 200) return `Seratus ${numberToTerbilang(n - 100)}`.trim();
    if (n < 1000) return `${numberToTerbilang(Math.floor(n / 100))} Ratus ${numberToTerbilang(n % 100)}`.trim();
    if (n < 2000) return `Seribu ${numberToTerbilang(n - 1000)}`.trim();
    if (n < 1000000) return `${numberToTerbilang(Math.floor(n / 1000))} Ribu ${numberToTerbilang(n % 1000)}`.trim();
    if (n < 1000000000) return `${numberToTerbilang(Math.floor(n / 1000000))} Juta ${numberToTerbilang(n % 1000000)}`.trim();
    if (n < 1000000000000) return `${numberToTerbilang(Math.floor(n / 1000000000))} Miliar ${numberToTerbilang(n % 1000000000)}`.trim();
    return `${n}`;
  }

  const SCHOOL_BANK_ACCOUNTS = [
    {
      bankName: 'Bank BCA',
      accountNumber: '7890-123-456',
      accountHolder: 'PKBM AL ABROR NUSANTARA',
      branch: 'KCP Sudirman Jakarta',
      logoColor: 'from-blue-600 to-blue-800',
      badge: 'BCA Virtual / Transfer'
    },
    {
      bankName: 'Bank BRI',
      accountNumber: '0123-01-000456-50-8',
      accountHolder: 'PKBM AL ABROR PENDIDIKAN',
      branch: 'KC Jakarta Pusat',
      logoColor: 'from-blue-700 to-indigo-900',
      badge: 'BRImo / ATM / Teller'
    },
    {
      bankName: 'Bank Mandiri',
      accountNumber: '137-00-9876543-2',
      accountHolder: 'PKBM AL ABROR',
      branch: 'KC Thamrin',
      logoColor: 'from-amber-600 to-blue-900',
      badge: 'Livin by Mandiri'
    },
    {
      bankName: 'Bank Syariah Indonesia (BSI)',
      accountNumber: '7123-456-789',
      accountHolder: 'YAYASAN PENDIDIKAN AL ABROR',
      branch: 'KCP BSI Hasanuddin',
      logoColor: 'from-teal-600 to-emerald-800',
      badge: 'BSI Mobile'
    },
    {
      bankName: 'QRIS Standar Pembayaran Nasional',
      accountNumber: 'NMID: ID1020089283741',
      accountHolder: 'PKBM AL-ABROR RESMI',
      branch: 'Semua E-Wallet & Mobile Banking',
      logoColor: 'from-rose-600 to-red-800',
      badge: 'GoPay, OVO, Dana, ShopeePay'
    }
  ];

  // Helper to generate official receipt number
  function generateReceiptCode(invoiceId: number): string {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const idPad = String(invoiceId).padStart(4, '0');
    return `KWT-${yearMonth}-${idPad}`;
  }

  // Helper to format Invoice ID as [NISN-NIS] according to student NISN and NIS
  function formatInvoiceTag(nisn?: string | null, nis?: string | null): string {
    const cleanNisn = (nisn || '').trim() || '0000000000';
    const cleanNis = (nis || '').trim() || '000000';
    return `[${cleanNisn}-${cleanNis}]`;
  }

  // ==================== KEUANGAN: INVOICES & PAYMENTS ====================
  app.get("/api/invoices", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const isSuperadmin = user.role === 'superadmin';
      const hasFinanceAccess = Boolean(user.financeAccess) || isSuperadmin || user.role === 'bendahara';

      // 1. SISWA VIEW (Only their own invoices & payments)
      if (user.role === 'siswa') {
        const studentRecord = await db.select().from(schema.students).where(eq(schema.students.userId, user.id)).limit(1);
        if (studentRecord.length === 0) {
          return res.json({
            role: 'siswa',
            invoices: [],
            payments: [],
            summary: {
              totalBills: 0,
              totalPaid: 0,
              totalUnpaid: 0,
              countUnpaid: 0,
              countProcessing: 0
            },
            studentInfo: { name: user.name, nis: '-', nisn: '-', invoiceTag: '[-]', program: '-' },
            bankAccounts: SCHOOL_BANK_ACCOUNTS
          });
        }

        const student = studentRecord[0];
        const studentInvoicesRaw = await db.select({
          id: schema.invoices.id,
          studentId: schema.invoices.studentId,
          amount: schema.invoices.amount,
          description: schema.invoices.description,
          category: schema.invoices.category,
          items: schema.invoices.items,
          dueDate: schema.invoices.dueDate,
          status: schema.invoices.status,
          paidAmount: schema.invoices.paidAmount,
          paidAt: schema.invoices.paidAt,
          paymentMethod: schema.invoices.paymentMethod,
          paymentProofUrl: schema.invoices.paymentProofUrl,
          paymentNotes: schema.invoices.paymentNotes,
          receiptNumber: schema.invoices.receiptNumber,
          verifiedBy: schema.invoices.verifiedBy,
          createdAt: schema.invoices.createdAt,
          studentName: schema.users.name,
          nis: schema.students.nis,
          nisn: schema.students.nisn,
          nik: schema.students.nik,
          program: schema.students.program,
          rombelName: schema.rombel.name,
        }).from(schema.invoices)
          .leftJoin(schema.students, eq(schema.invoices.studentId, schema.students.id))
          .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
          .leftJoin(schema.rombel, eq(schema.students.rombelId, schema.rombel.id))
          .where(eq(schema.invoices.studentId, student.id));

        const studentInvoices = studentInvoicesRaw.map(inv => ({
          ...inv,
          invoiceTag: formatInvoiceTag(inv.nisn, inv.nis)
        }));

        const invoiceIds = studentInvoices.map(i => i.id);
        let payments: any[] = [];
        if (invoiceIds.length > 0) {
          payments = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.studentId, student.id));
        }

        let totalBills = 0;
        let totalPaid = 0;
        let totalUnpaid = 0;
        let countUnpaid = 0;
        let countProcessing = 0;

        studentInvoices.forEach(inv => {
          totalBills += inv.amount;
          if (inv.status === 'paid') {
            totalPaid += inv.amount;
          } else {
            const paidPart = inv.paidAmount || 0;
            totalPaid += paidPart;
            totalUnpaid += Math.max(0, inv.amount - paidPart);
            if (inv.status === 'processing') {
              countProcessing++;
            } else {
              countUnpaid++;
            }
          }
        });

        return res.json({
          role: 'siswa',
          invoices: studentInvoices,
          payments,
          summary: {
            totalBills,
            totalPaid,
            totalUnpaid,
            countUnpaid,
            countProcessing,
            countPaid: studentInvoices.filter(i => i.status === 'paid').length
          },
          studentInfo: {
            id: student.id,
            name: user.name,
            nis: student.nis || '2401001',
            nisn: student.nisn || '-',
            nik: student.nik || '-',
            invoiceTag: formatInvoiceTag(student.nisn, student.nis),
            program: student.program || 'Paket C',
            rombelName: studentInvoices[0]?.rombelName || 'Belum Ditentukan'
          },
          bankAccounts: SCHOOL_BANK_ACCOUNTS
        });
      }

      // 2. ADMIN / SUPERADMIN / FINANCE ACCESS VIEW
      if (hasFinanceAccess) {
        const allInvoicesRaw = await db.select({
          id: schema.invoices.id,
          studentId: schema.invoices.studentId,
          amount: schema.invoices.amount,
          description: schema.invoices.description,
          category: schema.invoices.category,
          items: schema.invoices.items,
          dueDate: schema.invoices.dueDate,
          status: schema.invoices.status,
          paidAmount: schema.invoices.paidAmount,
          paidAt: schema.invoices.paidAt,
          paymentMethod: schema.invoices.paymentMethod,
          paymentProofUrl: schema.invoices.paymentProofUrl,
          paymentNotes: schema.invoices.paymentNotes,
          receiptNumber: schema.invoices.receiptNumber,
          verifiedBy: schema.invoices.verifiedBy,
          createdAt: schema.invoices.createdAt,
          studentName: schema.users.name,
          nis: schema.students.nis,
          nisn: schema.students.nisn,
          nik: schema.students.nik,
          program: schema.students.program,
          rombelId: schema.students.rombelId,
          rombelName: schema.rombel.name,
        }).from(schema.invoices)
          .leftJoin(schema.students, eq(schema.invoices.studentId, schema.students.id))
          .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
          .leftJoin(schema.rombel, eq(schema.students.rombelId, schema.rombel.id));

        const allInvoices = allInvoicesRaw.map(inv => ({
          ...inv,
          invoiceTag: formatInvoiceTag(inv.nisn, inv.nis)
        }));

        const allPayments = await db.select().from(schema.invoicePayments);
        const allCategories = await db.select().from(schema.invoiceCategories);

        let totalInvoiced = 0;
        let totalRevenue = 0;
        let totalOutstanding = 0;
        let pendingVerifications = 0;
        const studentsWithDebt = new Set<number>();

        allInvoices.forEach(inv => {
          totalInvoiced += inv.amount;
          if (inv.status === 'paid') {
            totalRevenue += inv.amount;
          } else {
            const paidPart = inv.paidAmount || 0;
            totalRevenue += paidPart;
            const remaining = Math.max(0, inv.amount - paidPart);
            totalOutstanding += remaining;
            if (inv.studentId) studentsWithDebt.add(inv.studentId);
            if (inv.status === 'processing') {
              pendingVerifications++;
            }
          }
        });

        return res.json({
          role: isSuperadmin ? 'superadmin' : 'finance_staff',
          invoices: allInvoices,
          payments: allPayments,
          categories: allCategories,
          summary: {
            totalInvoiced,
            totalRevenue,
            totalOutstanding,
            pendingVerifications,
            totalInvoicesCount: allInvoices.length,
            paidInvoicesCount: allInvoices.filter(i => i.status === 'paid').length,
            unpaidInvoicesCount: allInvoices.filter(i => i.status !== 'paid').length,
            studentsWithDebtCount: studentsWithDebt.size,
            categoriesCount: allCategories.length
          },
          bankAccounts: SCHOOL_BANK_ACCOUNTS
        });
      }

      // 3. UNAUTHORIZED ROLE
      return res.status(403).json({
        error: "Akses Terbatas: Fitur Manajemen Keuangan hanya dapat diakses oleh Superadmin dan akun yang telah diberikan hak akses khusus oleh Superadmin."
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== INVOICE CATEGORIES CRUD ====================
  app.get("/api/invoice-categories", authenticateToken, async (req: any, res: any) => {
    try {
      const allCats = await db.select().from(schema.invoiceCategories);
      res.json(allCats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/invoice-categories", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const hasFinanceAccess = Boolean(user.financeAccess) || user.role === 'superadmin' || user.role === 'admin' || user.role === 'bendahara';
      if (!hasFinanceAccess) {
        return res.status(403).json({ error: "Hanya Superadmin, Admin, atau Petugas Keuangan/Bendahara yang berwenang mengelola kategori tagihan." });
      }

      const { name, defaultAmount, description, program = 'Semua Program', periodType = 'Bulanan', isActive = true } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Nama kategori tagihan wajib diisi." });
      }

      const parsedAmount = parseFloat(defaultAmount) || 0;
      const trimmedName = name.trim();

      const existing = await db.select().from(schema.invoiceCategories).where(eq(schema.invoiceCategories.name, trimmedName));
      if (existing.length > 0) {
        return res.status(400).json({ error: `Kategori "${trimmedName}" sudah terdaftar.` });
      }

      const result = await db.insert(schema.invoiceCategories).values({
        name: trimmedName,
        defaultAmount: parsedAmount,
        description: description || '',
        program: program || 'Semua Program',
        periodType: periodType || 'Bulanan',
        isActive: Boolean(isActive),
        createdAt: new Date().toISOString()
      }).returning();

      res.json({
        success: true,
        message: `Kategori tagihan "${trimmedName}" dengan nominal Rp ${parsedAmount.toLocaleString('id-ID')} berhasil ditambahkan.`,
        category: result[0]
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/invoice-categories/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const hasFinanceAccess = Boolean(user.financeAccess) || user.role === 'superadmin' || user.role === 'admin' || user.role === 'bendahara';
      if (!hasFinanceAccess) {
        return res.status(403).json({ error: "Akses ditolak" });
      }

      const id = parseInt(req.params.id);
      const { name, defaultAmount, description, program, periodType, isActive } = req.body;

      const updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (defaultAmount !== undefined) updateData.defaultAmount = parseFloat(defaultAmount) || 0;
      if (description !== undefined) updateData.description = description;
      if (program !== undefined) updateData.program = program;
      if (periodType !== undefined) updateData.periodType = periodType;
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      await db.update(schema.invoiceCategories).set(updateData).where(eq(schema.invoiceCategories.id, id));
      res.json({ success: true, message: "Kategori tagihan dan nominal biaya berhasil diperbarui." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/invoice-categories/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const hasFinanceAccess = Boolean(user.financeAccess) || user.role === 'superadmin' || user.role === 'admin' || user.role === 'bendahara';
      if (!hasFinanceAccess) {
        return res.status(403).json({ error: "Akses ditolak" });
      }

      const id = parseInt(req.params.id);
      await db.delete(schema.invoiceCategories).where(eq(schema.invoiceCategories.id, id));
      res.json({ success: true, message: "Kategori tagihan berhasil dihapus." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== STUDENTS DEBT & ARREARS STATUS SUMMARY ====================
  app.get("/api/invoices/students-debt-summary", authenticateToken, async (req: any, res: any) => {
    try {
      const allStudents = await db.select({
        id: schema.students.id,
        userId: schema.students.userId,
        nis: schema.students.nis,
        nisn: schema.students.nisn,
        nik: schema.students.nik,
        program: schema.students.program,
        rombelId: schema.students.rombelId,
        studentName: schema.users.name,
        rombelName: schema.rombel.name,
      }).from(schema.students)
        .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
        .leftJoin(schema.rombel, eq(schema.students.rombelId, schema.rombel.id));

      const allInvoices = await db.select().from(schema.invoices);

      const debtSummary = allStudents.map(st => {
        const studentInvs = allInvoices.filter(i => i.studentId === st.id);
        let totalInvoiced = 0;
        let totalPaid = 0;
        let totalUnpaid = 0;
        const unpaidInvoices: any[] = [];
        const paidInvoices: any[] = [];

        studentInvs.forEach(inv => {
          const invWithTag = {
            ...inv,
            invoiceTag: formatInvoiceTag(st.nisn, st.nis)
          };
          totalInvoiced += inv.amount;
          if (inv.status === 'paid') {
            totalPaid += inv.amount;
            paidInvoices.push(invWithTag);
          } else {
            const paidPart = inv.paidAmount || 0;
            totalPaid += paidPart;
            const remaining = Math.max(0, inv.amount - paidPart);
            totalUnpaid += remaining;
            unpaidInvoices.push(invWithTag);
          }
        });

        return {
          ...st,
          nis: st.nis || `2401${String(st.id).padStart(3, '0')}`,
          invoiceTag: formatInvoiceTag(st.nisn, st.nis),
          totalInvoiced,
          totalPaid,
          totalUnpaid,
          unpaidCount: unpaidInvoices.length,
          hasUnpaidDebt: totalUnpaid > 0 || unpaidInvoices.length > 0,
          unpaidInvoices,
          paidInvoices
        };
      });

      res.json(debtSummary);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Create Invoices (Single, Multi-Category, Batch per Rombel, or Batch per Program with Unpaid-Only Check)
  app.post("/api/invoices", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const hasFinanceAccess = Boolean(user.financeAccess) || user.role === 'superadmin' || user.role === 'admin' || user.role === 'bendahara';
      if (!hasFinanceAccess) {
        return res.status(403).json({ error: "Anda tidak memiliki wewenang untuk membuat tagihan keuangan." });
      }

      const { targetType, studentId, rombelId, program, amount, description, category, dueDate, onlyUnpaid = false, items = [] } = req.body;

      const invoiceDueDate = dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const nowIso = new Date().toISOString();

      // Normalize items list if provided
      const hasCustomItems = Array.isArray(items) && items.length > 0;

      // Helper to prepare items and calculate sum
      const prepareInvoiceDataForStudent = async (stId: number) => {
        let finalItems: Array<{ category: string; description: string; amount: number; dueDate?: string }> = [];

        if (hasCustomItems) {
          finalItems = items.map(it => ({
            category: it.category || 'Tagihan Pendidikan',
            description: it.description || it.category || 'Biaya Pendidikan',
            amount: parseFloat(it.amount) || 0,
            dueDate: it.dueDate || invoiceDueDate
          })).filter(it => it.amount > 0);
        } else {
          const singleAmount = parseFloat(amount) || 0;
          const singleDesc = description || 'Tagihan Biaya Pendidikan';
          const singleCat = category || 'SPP Bulanan';
          finalItems = [{
            category: singleCat,
            description: singleDesc,
            amount: singleAmount,
            dueDate: invoiceDueDate
          }];
        }

        if (onlyUnpaid) {
          const existingInvs = await db.select().from(schema.invoices).where(eq(schema.invoices.studentId, stId));
          // Filter out items already paid or already actively pending
          finalItems = finalItems.filter(item => {
            const alreadyPaid = existingInvs.some(i => {
              if (i.status === 'paid') {
                if (i.category === item.category && i.description.trim().toLowerCase() === item.description.trim().toLowerCase()) return true;
                if (i.items) {
                  try {
                    const parsed = JSON.parse(i.items);
                    if (Array.isArray(parsed) && parsed.some(p => p.category === item.category && p.description.trim().toLowerCase() === item.description.trim().toLowerCase())) return true;
                  } catch (e) {}
                }
              }
              return false;
            });
            const hasPendingDuplicate = existingInvs.some(i => {
              if (i.status !== 'paid') {
                if (i.category === item.category && i.description.trim().toLowerCase() === item.description.trim().toLowerCase()) return true;
                if (i.items) {
                  try {
                    const parsed = JSON.parse(i.items);
                    if (Array.isArray(parsed) && parsed.some(p => p.category === item.category && p.description.trim().toLowerCase() === item.description.trim().toLowerCase())) return true;
                  } catch (e) {}
                }
              }
              return false;
            });
            return !alreadyPaid && !hasPendingDuplicate;
          });
        }

        const totalCalculatedAmount = finalItems.reduce((sum, it) => sum + it.amount, 0);
        const finalCategory = finalItems.length > 1 ? 'Multi-Kategori' : (finalItems[0]?.category || category || 'Tagihan Pendidikan');
        const finalDesc = description && description.trim() 
          ? description.trim() 
          : (finalItems.length > 1 
              ? `1 Lembar Tagihan Terpadu (${finalItems.map(i => i.category).join(', ')})` 
              : (finalItems[0]?.description || 'Tagihan Biaya Pendidikan'));

        return {
          finalItems,
          totalAmount: totalCalculatedAmount,
          finalCategory,
          finalDesc
        };
      };

      if (targetType === 'rombel' && rombelId) {
        const studentsInRombel = await db.select().from(schema.students).where(eq(schema.students.rombelId, parseInt(rombelId)));
        if (studentsInRombel.length === 0) {
          return res.status(400).json({ error: "Tidak ada siswa yang terdaftar di kelas / rombel ini." });
        }

        let createdCount = 0;
        let skippedCount = 0;

        for (const st of studentsInRombel) {
          const invData = await prepareInvoiceDataForStudent(st.id);
          if (invData.finalItems.length === 0 || invData.totalAmount <= 0) {
            skippedCount++;
            continue;
          }

          await db.insert(schema.invoices).values({
            studentId: st.id,
            amount: invData.totalAmount,
            description: invData.finalDesc,
            category: invData.finalCategory,
            items: JSON.stringify(invData.finalItems),
            dueDate: invoiceDueDate,
            status: 'pending',
            paidAmount: 0,
            createdAt: nowIso
          });
          createdCount++;
        }

        if (createdCount === 0) {
          return res.status(400).json({
            error: "Seluruh siswa di rombel ini telah lunas atau sudah memiliki tagihan aktif untuk kategori tersebut. Tidak ada tagihan baru yang diterbitkan."
          });
        }

        return res.json({
          success: true,
          count: createdCount,
          skippedCount,
          message: `Berhasil menerbitkan ${createdCount} lembar tagihan untuk siswa di rombel terkait (${skippedCount} siswa dilewati karena sudah lunas/tertagih).`
        });
      }

      if (targetType === 'program' && program) {
        const studentsInProgram = await db.select().from(schema.students).where(eq(schema.students.program, program));
        if (studentsInProgram.length === 0) {
          return res.status(400).json({ error: `Tidak ada siswa yang terdaftar di program ${program}.` });
        }

        let createdCount = 0;
        let skippedCount = 0;

        for (const st of studentsInProgram) {
          const invData = await prepareInvoiceDataForStudent(st.id);
          if (invData.finalItems.length === 0 || invData.totalAmount <= 0) {
            skippedCount++;
            continue;
          }

          await db.insert(schema.invoices).values({
            studentId: st.id,
            amount: invData.totalAmount,
            description: invData.finalDesc,
            category: invData.finalCategory,
            items: JSON.stringify(invData.finalItems),
            dueDate: invoiceDueDate,
            status: 'pending',
            paidAmount: 0,
            createdAt: nowIso
          });
          createdCount++;
        }

        if (createdCount === 0) {
          return res.status(400).json({
            error: `Seluruh siswa di program ${program} telah lunas atau sudah memiliki tagihan aktif. Tidak ada tagihan baru yang diterbitkan.`
          });
        }

        return res.json({
          success: true,
          count: createdCount,
          skippedCount,
          message: `Berhasil menerbitkan ${createdCount} lembar tagihan untuk siswa ${program} (${skippedCount} siswa dilewati karena sudah lunas/tertagih).`
        });
      }

      // Single Student Target
      if (!studentId) {
        return res.status(400).json({ error: "Silakan pilih siswa penerima tagihan." });
      }

      const stIdNum = parseInt(studentId);
      const invData = await prepareInvoiceDataForStudent(stIdNum);

      if (invData.finalItems.length === 0 || invData.totalAmount <= 0) {
        return res.status(400).json({
          error: "Siswa ini terekam sudah melunasi seluruh kewajiban pada kategori yang dipilih atau sudah memiliki tagihan aktif."
        });
      }

      const result = await db.insert(schema.invoices).values({
        studentId: stIdNum,
        amount: invData.totalAmount,
        description: invData.finalDesc,
        category: invData.finalCategory,
        items: JSON.stringify(invData.finalItems),
        dueDate: invoiceDueDate,
        status: 'pending',
        paidAmount: 0,
        createdAt: nowIso,
      });

      res.json({
        id: result.lastInsertRowid,
        success: true,
        message: `1 Lembar Tagihan ${invData.finalCategory === 'Multi-Kategori' ? 'Terpadu (Multi-Kategori)' : ''} sebesar Rp ${invData.totalAmount.toLocaleString('id-ID')} berhasil diterbitkan ke portal siswa.`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate Consolidated Statement from Debt / Arrears Records Automatically
  app.post("/api/invoices/generate-consolidated-from-debt", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const hasFinanceAccess = Boolean(user.financeAccess) || user.role === 'superadmin' || user.role === 'admin' || user.role === 'bendahara';
      if (!hasFinanceAccess) {
        return res.status(403).json({ error: "Wewenang tidak mencukupi." });
      }

      const { studentId, allUnpaidStudents = false, rombelId, program, dueDate } = req.body;
      const invoiceDueDate = dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const nowIso = new Date().toISOString();

      let targetStudentIds: number[] = [];
      if (studentId) {
        targetStudentIds = [parseInt(studentId)];
      } else if (allUnpaidStudents) {
        let studentsList = await db.select().from(schema.students);
        if (rombelId) {
          studentsList = studentsList.filter(s => s.rombelId === parseInt(rombelId));
        }
        if (program) {
          studentsList = studentsList.filter(s => s.program === program);
        }
        targetStudentIds = studentsList.map(s => s.id);
      }

      if (targetStudentIds.length === 0) {
        return res.status(400).json({ error: "Silakan tentukan siswa atau kriteria target." });
      }

      const allInvoices = await db.select().from(schema.invoices);
      let consolidatedCount = 0;

      for (const sId of targetStudentIds) {
        const studentPendingInvs = allInvoices.filter(i => i.studentId === sId && i.status !== 'paid');
        if (studentPendingInvs.length === 0) continue;

        // Collect all items from pending invoices
        const consolidatedItems: Array<{ category: string; description: string; amount: number; dueDate?: string }> = [];
        let totalDebt = 0;

        studentPendingInvs.forEach(inv => {
          const remainingAmount = Math.max(0, inv.amount - (inv.paidAmount || 0));
          if (remainingAmount <= 0) return;

          if (inv.items) {
            try {
              const parsed = JSON.parse(inv.items);
              if (Array.isArray(parsed) && parsed.length > 0) {
                parsed.forEach(p => {
                  consolidatedItems.push({
                    category: p.category || inv.category || 'Tagihan Pendidikan',
                    description: p.description || inv.description,
                    amount: parseFloat(p.amount) || remainingAmount,
                    dueDate: p.dueDate || inv.dueDate || invoiceDueDate
                  });
                  totalDebt += parseFloat(p.amount) || remainingAmount;
                });
                return;
              }
            } catch (e) {}
          }

          consolidatedItems.push({
            category: inv.category || 'Tagihan Pendidikan',
            description: inv.description,
            amount: remainingAmount,
            dueDate: inv.dueDate || invoiceDueDate
          });
          totalDebt += remainingAmount;
        });

        if (consolidatedItems.length === 0 || totalDebt <= 0) continue;

        // If student already has only 1 invoice with these exact items, no need to recreate
        if (studentPendingInvs.length === 1 && studentPendingInvs[0].category === 'Multi-Kategori') {
          continue;
        }

        // Delete/cancel previous fragmented pending invoices and create 1 single consolidated billing statement
        for (const prevInv of studentPendingInvs) {
          await db.delete(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, prevInv.id));
          await db.delete(schema.invoices).where(eq(schema.invoices.id, prevInv.id));
        }

        // Insert new consolidated statement
        await db.insert(schema.invoices).values({
          studentId: sId,
          amount: totalDebt,
          description: `1 Lembar Tagihan Terpadu (${consolidatedItems.length} Kategori Kewajiban)`,
          category: 'Multi-Kategori',
          items: JSON.stringify(consolidatedItems),
          dueDate: invoiceDueDate,
          status: 'pending',
          paidAmount: 0,
          createdAt: nowIso
        });

        consolidatedCount++;
      }

      res.json({
        success: true,
        consolidatedCount,
        message: `Berhasil menggabungkan dan menerbitkan ${consolidatedCount} lembar tagihan terpadu multi-kategori otomatis berdasarkan data rekam kewajiban siswa.`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Edit Invoice
  app.put("/api/invoices/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const hasFinanceAccess = Boolean(user.financeAccess) || user.role === 'superadmin' || user.role === 'bendahara';
      if (!hasFinanceAccess) {
        return res.status(403).json({ error: "Akses ditolak" });
      }

      const invoiceId = parseInt(req.params.id);
      const { amount, description, category, dueDate, status } = req.body;
      const updateData: any = {};
      if (amount !== undefined) updateData.amount = parseFloat(amount);
      if (description !== undefined) updateData.description = description;
      if (category !== undefined) updateData.category = category;
      if (dueDate !== undefined) updateData.dueDate = dueDate;
      if (status !== undefined) {
        updateData.status = status;
        if (status === 'paid') {
          updateData.paidAt = new Date().toISOString();
          updateData.receiptNumber = generateReceiptCode(invoiceId);
          updateData.verifiedBy = user.name;
        }
      }

      await db.update(schema.invoices).set(updateData).where(eq(schema.invoices.id, invoiceId));
      res.json({ success: true, message: "Data tagihan berhasil diperbarui." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Delete Invoice
  app.delete("/api/invoices/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const hasFinanceAccess = Boolean(user.financeAccess) || user.role === 'superadmin' || user.role === 'bendahara';
      if (!hasFinanceAccess) {
        return res.status(403).json({ error: "Akses ditolak" });
      }

      const invoiceId = parseInt(req.params.id);
      await db.delete(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, invoiceId));
      await db.delete(schema.invoices).where(eq(schema.invoices.id, invoiceId));

      res.json({ success: true, message: "Tagihan berhasil dihapus." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Pay Invoice / Submit Payment Proof (by Student or Staff)
  app.post("/api/invoices/:id/pay", authenticateToken, upload.single('proofFile'), async (req: any, res: any) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const user = req.user;
      const isStaff = user.role === 'superadmin' || user.role === 'bendahara' || Boolean(user.financeAccess);

      const invList = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
      if (invList.length === 0) {
        return res.status(404).json({ error: "Tagihan tidak ditemukan." });
      }
      const inv = invList[0];

      let proofUrl = req.body.proofUrl || '';
      if (req.file) {
        proofUrl = `/uploads/${req.file.filename}`;
      }

      const { paymentMethod, paymentNotes, paidDate, amount } = req.body;
      const paymentAmount = amount ? parseFloat(amount) : inv.amount;
      const now = new Date();
      const paidAtStr = paidDate ? `${paidDate} 10:00:00` : now.toISOString();

      // IF LOGGED IN USER IS SISWA (Submit Proof)
      if (user.role === 'siswa') {
        const studentRecord = await db.select().from(schema.students).where(eq(schema.students.userId, user.id)).limit(1);
        if (studentRecord.length === 0 || studentRecord[0].id !== inv.studentId) {
          return res.status(403).json({ error: "Anda tidak berhak membayar tagihan siswa lain." });
        }

        // Update invoice to 'processing'
        await db.update(schema.invoices).set({
          status: 'processing',
          paymentMethod: paymentMethod || 'Transfer Bank',
          paymentProofUrl: proofUrl,
          paymentNotes: paymentNotes || 'Konfirmasi pembayaran dari siswa',
        }).where(eq(schema.invoices.id, invoiceId));

        // Insert pending payment record
        await db.insert(schema.invoicePayments).values({
          invoiceId,
          studentId: inv.studentId,
          amount: paymentAmount,
          paymentMethod: paymentMethod || 'Transfer Bank',
          proofUrl,
          paidAt: paidAtStr,
          notes: paymentNotes || '',
          status: 'pending_verification',
        });

        return res.json({
          success: true,
          status: 'processing',
          message: "Konfirmasi & bukti pembayaran berhasil dikirim. Bendahara/Admin akan memverifikasi pembayaran Anda secepatnya."
        });
      }

      // IF LOGGED IN USER IS STAFF / SUPERADMIN (Manual direct payment record)
      if (isStaff) {
        const receiptNumber = generateReceiptCode(invoiceId);

        await db.update(schema.invoices).set({
          status: 'paid',
          paidAmount: paymentAmount,
          paidAt: paidAtStr,
          paymentMethod: paymentMethod || 'Tunai / Kasir PKBM',
          paymentProofUrl: proofUrl,
          paymentNotes: paymentNotes || 'Pembayaran langsung di loket kasir / bendahara',
          receiptNumber,
          verifiedBy: user.name
        }).where(eq(schema.invoices.id, invoiceId));

        await db.insert(schema.invoicePayments).values({
          invoiceId,
          studentId: inv.studentId,
          amount: paymentAmount,
          paymentMethod: paymentMethod || 'Tunai / Kasir PKBM',
          proofUrl,
          paidAt: paidAtStr,
          receiptNumber,
          notes: paymentNotes || '',
          status: 'verified',
          verifiedBy: user.name,
          verifiedAt: now.toISOString()
        });

        return res.json({
          success: true,
          status: 'paid',
          receiptNumber,
          message: `Pembayaran sebesar Rp ${paymentAmount.toLocaleString('id-ID')} berhasil dicatat & Kuitansi ${receiptNumber} telah diterbitkan.`
        });
      }

      return res.status(403).json({ error: "Wewenang tidak mencukupi." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Verify / Approve / Reject Payment from Student (Superadmin / Finance Staff Only)
  app.post("/api/invoices/:id/verify-payment", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      const isStaff = user.role === 'superadmin' || user.role === 'bendahara' || Boolean(user.financeAccess);
      if (!isStaff) {
        return res.status(403).json({ error: "Hanya Superadmin, Bendahara, atau Staf Keuangan yang dapat memverifikasi pembayaran." });
      }

      const invoiceId = parseInt(req.params.id);
      const { action, rejectReason } = req.body; // action: 'approve' | 'reject'

      const invList = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
      if (invList.length === 0) {
        return res.status(404).json({ error: "Tagihan tidak ditemukan" });
      }
      const inv = invList[0];

      if (action === 'approve') {
        const receiptNumber = inv.receiptNumber || generateReceiptCode(invoiceId);
        const nowIso = new Date().toISOString();

        await db.update(schema.invoices).set({
          status: 'paid',
          paidAmount: inv.amount,
          paidAt: nowIso,
          receiptNumber,
          verifiedBy: user.name
        }).where(eq(schema.invoices.id, invoiceId));

        // Update payment table record
        await db.update(schema.invoicePayments).set({
          status: 'verified',
          receiptNumber,
          verifiedBy: user.name,
          verifiedAt: nowIso
        }).where(eq(schema.invoicePayments.invoiceId, invoiceId));

        return res.json({
          success: true,
          receiptNumber,
          message: `Pembayaran telah diverifikasi sah. Kuitansi resmi ${receiptNumber} berhasil diterbitkan.`
        });
      } else {
        // Reject
        await db.update(schema.invoices).set({
          status: 'pending',
          paymentNotes: `Bukti transfer ditolak: ${rejectReason || 'Bukti transfer tidak jelas / nominal tidak sesuai.'}`
        }).where(eq(schema.invoices.id, invoiceId));

        await db.update(schema.invoicePayments).set({
          status: 'rejected',
          notes: `Ditolak oleh ${user.name}: ${rejectReason || 'Tidak valid'}`
        }).where(eq(schema.invoicePayments.invoiceId, invoiceId));

        return res.json({
          success: true,
          message: "Pembayaran telah ditolak dan status tagihan dikembalikan ke Belum Lunas."
        });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Digital Receipt Details
  app.get("/api/invoices/:id/receipt", authenticateToken, async (req: any, res: any) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const user = req.user;

      const invoiceData = await db.select({
        id: schema.invoices.id,
        studentId: schema.invoices.studentId,
        amount: schema.invoices.amount,
        description: schema.invoices.description,
        category: schema.invoices.category,
        items: schema.invoices.items,
        dueDate: schema.invoices.dueDate,
        status: schema.invoices.status,
        paidAmount: schema.invoices.paidAmount,
        paidAt: schema.invoices.paidAt,
        paymentMethod: schema.invoices.paymentMethod,
        paymentNotes: schema.invoices.paymentNotes,
        receiptNumber: schema.invoices.receiptNumber,
        verifiedBy: schema.invoices.verifiedBy,
        createdAt: schema.invoices.createdAt,
        studentName: schema.users.name,
        nis: schema.students.nis,
        nisn: schema.students.nisn,
        nik: schema.students.nik,
        program: schema.students.program,
        rombelName: schema.rombel.name,
        userId: schema.students.userId,
      }).from(schema.invoices)
        .leftJoin(schema.students, eq(schema.invoices.studentId, schema.students.id))
        .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
        .leftJoin(schema.rombel, eq(schema.students.rombelId, schema.rombel.id))
        .where(eq(schema.invoices.id, invoiceId));

      if (invoiceData.length === 0) {
        return res.status(404).json({ error: "Kuitansi tidak ditemukan" });
      }

      const inv = invoiceData[0];
      const isStaff = user.role === 'superadmin' || user.role === 'bendahara' || Boolean(user.financeAccess);
      if (user.role === 'siswa' && inv.userId !== user.id) {
        return res.status(403).json({ error: "Anda tidak berhak melihat kuitansi siswa lain." });
      }

      const amountToSpell = inv.paidAmount || inv.amount;
      const terbilangStr = `${numberToTerbilang(amountToSpell)} Rupiah`;
      const invoiceTag = formatInvoiceTag(inv.nisn, inv.nis);

      let parsedItems: any[] = [];
      if (inv.items) {
        try {
          const parsed = JSON.parse(inv.items);
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsedItems = parsed;
          }
        } catch (e) {}
      }
      if (parsedItems.length === 0) {
        parsedItems = [{
          category: inv.category || 'Tagihan Pendidikan',
          description: inv.description,
          amount: amountToSpell
        }];
      }

      res.json({
        receiptNumber: inv.receiptNumber || generateReceiptCode(inv.id),
        invoiceId: inv.id,
        invoiceTag,
        institution: {
          name: "PUSAT KEGIATAN BELAJAR MASYARAKAT (PKBM) AL-ABROR",
          npsn: "P9962817",
          skIzin: "421.1/1089/Disdik/2021",
          address: "Jl. Pendidikan Kesetaraan No. 45, Jakarta",
          phone: "+62 811 2345 6789",
          email: "keuangan@pkbm-alabror.sch.id",
          website: "https://alabror.sch.id"
        },
        student: {
          name: inv.studentName,
          nis: inv.nis || '-',
          nisn: inv.nisn || '-',
          nik: inv.nik || '-',
          invoiceTag,
          program: inv.program || 'Paket C',
          rombel: inv.rombelName || '-'
        },
        payment: {
          category: inv.category || 'SPP Bulanan',
          description: inv.description,
          items: parsedItems,
          amount: amountToSpell,
          terbilang: terbilangStr,
          paymentMethod: inv.paymentMethod || 'Transfer Bank Resmi PKBM',
          paidAt: inv.paidAt || inv.createdAt,
          status: inv.status === 'paid' ? 'LUNAS (SAH)' : inv.status === 'processing' ? 'MENUNGGU VERIFIKASI' : 'BELUM LUNAS',
          verifiedBy: inv.verifiedBy || 'Bendahara PKBM AL-ABROR'
        }
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Official Billing Statement (1 Lembar Surat Tagihan Multi-Kategori Resmi)
  app.get("/api/invoices/:id/statement", authenticateToken, async (req: any, res: any) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const user = req.user;

      const invoiceData = await db.select({
        id: schema.invoices.id,
        studentId: schema.invoices.studentId,
        amount: schema.invoices.amount,
        description: schema.invoices.description,
        category: schema.invoices.category,
        items: schema.invoices.items,
        dueDate: schema.invoices.dueDate,
        status: schema.invoices.status,
        paidAmount: schema.invoices.paidAmount,
        paidAt: schema.invoices.paidAt,
        paymentMethod: schema.invoices.paymentMethod,
        paymentNotes: schema.invoices.paymentNotes,
        receiptNumber: schema.invoices.receiptNumber,
        verifiedBy: schema.invoices.verifiedBy,
        createdAt: schema.invoices.createdAt,
        studentName: schema.users.name,
        nis: schema.students.nis,
        nisn: schema.students.nisn,
        nik: schema.students.nik,
        program: schema.students.program,
        rombelName: schema.rombel.name,
        userId: schema.students.userId,
      }).from(schema.invoices)
        .leftJoin(schema.students, eq(schema.invoices.studentId, schema.students.id))
        .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
        .leftJoin(schema.rombel, eq(schema.students.rombelId, schema.rombel.id))
        .where(eq(schema.invoices.id, invoiceId));

      if (invoiceData.length === 0) {
        return res.status(404).json({ error: "Lembar tagihan tidak ditemukan" });
      }

      const inv = invoiceData[0];
      if (user.role === 'siswa' && inv.userId !== user.id) {
        return res.status(403).json({ error: "Anda tidak berhak mengakses tagihan siswa lain." });
      }

      let parsedItems: any[] = [];
      if (inv.items) {
        try {
          const parsed = JSON.parse(inv.items);
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsedItems = parsed;
          }
        } catch (e) {}
      }
      if (parsedItems.length === 0) {
        parsedItems = [{
          category: inv.category || 'Tagihan Pendidikan',
          description: inv.description,
          amount: inv.amount,
          dueDate: inv.dueDate
        }];
      }

      const totalAmount = inv.amount;
      const terbilangStr = `${numberToTerbilang(totalAmount)} Rupiah`;
      const invoiceTag = formatInvoiceTag(inv.nisn, inv.nis);

      res.json({
        statementNumber: `ST-${invoiceTag}-${new Date(inv.createdAt || Date.now()).getFullYear()}${String(new Date(inv.createdAt || Date.now()).getMonth() + 1).padStart(2, '0')}-${inv.id.toString().padStart(4, '0')}`,
        invoiceId: inv.id,
        invoiceTag,
        createdAt: inv.createdAt,
        dueDate: inv.dueDate,
        status: inv.status,
        institution: {
          name: "PUSAT KEGIATAN BELAJAR MASYARAKAT (PKBM) AL-ABROR",
          npsn: "P9962817",
          skIzin: "421.1/1089/Disdik/2021",
          address: "Jl. Pendidikan Kesetaraan No. 45, Jakarta",
          phone: "+62 811 2345 6789",
          email: "keuangan@pkbm-alabror.sch.id",
          website: "https://alabror.sch.id"
        },
        student: {
          name: inv.studentName,
          nis: inv.nis || '-',
          nisn: inv.nisn || '-',
          nik: inv.nik || '-',
          invoiceTag,
          program: inv.program || 'Paket C',
          rombel: inv.rombelName || '-'
        },
        billing: {
          title: inv.description,
          category: inv.category,
          items: parsedItems,
          totalAmount,
          terbilang: terbilangStr,
          status: inv.status === 'paid' ? 'LUNAS (SAH)' : inv.status === 'processing' ? 'MENUNGGU VERIFIKASI' : 'BELUM LUNAS',
        },
        bankAccounts: SCHOOL_BANK_ACCOUNTS
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Student Consolidated All Unpaid Obligations Statement (Lembar Akumulasi Seluruh Tunggakan)
  app.get("/api/invoices/student/consolidated-statement", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      let targetStudentId: number | null = null;

      if (user.role === 'siswa') {
        const studentRecord = await db.select().from(schema.students).where(eq(schema.students.userId, user.id)).limit(1);
        if (studentRecord.length === 0) {
          return res.status(404).json({ error: "Data siswa tidak ditemukan." });
        }
        targetStudentId = studentRecord[0].id;
      } else {
        const queryStudentId = req.query.studentId;
        if (!queryStudentId) {
          return res.status(400).json({ error: "Parameter studentId wajib diisi." });
        }
        targetStudentId = parseInt(queryStudentId);
      }

      const studentDetails = await db.select({
        id: schema.students.id,
        nis: schema.students.nis,
        nisn: schema.students.nisn,
        nik: schema.students.nik,
        program: schema.students.program,
        rombelName: schema.rombel.name,
        studentName: schema.users.name,
      }).from(schema.students)
        .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
        .leftJoin(schema.rombel, eq(schema.students.rombelId, schema.rombel.id))
        .where(eq(schema.students.id, targetStudentId))
        .limit(1);

      if (studentDetails.length === 0) {
        return res.status(404).json({ error: "Siswa tidak ditemukan." });
      }

      const st = studentDetails[0];
      const studentInvs = await db.select().from(schema.invoices).where(eq(schema.invoices.studentId, targetStudentId));
      const unpaidInvs = studentInvs.filter(i => i.status !== 'paid');

      const items: any[] = [];
      let totalAmount = 0;

      unpaidInvs.forEach(inv => {
        const remaining = Math.max(0, inv.amount - (inv.paidAmount || 0));
        if (inv.items) {
          try {
            const parsed = JSON.parse(inv.items);
            if (Array.isArray(parsed) && parsed.length > 0) {
              parsed.forEach(p => {
                items.push({
                  category: p.category || inv.category || 'Tagihan Pendidikan',
                  description: p.description || inv.description,
                  amount: parseFloat(p.amount) || remaining,
                  dueDate: p.dueDate || inv.dueDate,
                  status: inv.status
                });
                totalAmount += parseFloat(p.amount) || remaining;
              });
              return;
            }
          } catch (e) {}
        }
        items.push({
          category: inv.category || 'Tagihan Pendidikan',
          description: inv.description,
          amount: remaining,
          dueDate: inv.dueDate,
          status: inv.status
        });
        totalAmount += remaining;
      });

      const terbilangStr = `${numberToTerbilang(totalAmount)} Rupiah`;
      const invoiceTag = formatInvoiceTag(st.nisn, st.nis);

      res.json({
        statementNumber: `ST-ALL-${invoiceTag}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${st.id.toString().padStart(4, '0')}`,
        invoiceTag,
        createdAt: new Date().toISOString(),
        dueDate: unpaidInvs[0]?.dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        hasUnpaid: items.length > 0,
        institution: {
          name: "PUSAT KEGIATAN BELAJAR MASYARAKAT (PKBM) AL-ABROR",
          npsn: "P9962817",
          skIzin: "421.1/1089/Disdik/2021",
          address: "Jl. Pendidikan Kesetaraan No. 45, Jakarta",
          phone: "+62 811 2345 6789",
          email: "keuangan@pkbm-alabror.sch.id",
          website: "https://alabror.sch.id"
        },
        student: {
          name: st.studentName,
          nis: st.nis || '-',
          nisn: st.nisn || '-',
          nik: st.nik || '-',
          invoiceTag,
          program: st.program || 'Paket C',
          rombel: st.rombelName || '-'
        },
        billing: {
          title: `Lembar Akumulasi Rincian Kewajiban Siswa (${items.length} Rincian)`,
          items,
          totalAmount,
          terbilang: terbilangStr,
          status: unpaidInvs.some(i => i.status === 'processing') ? 'MENUNGGU VERIFIKASI SEBAGIAN' : 'BELUM LUNAS',
        },
        bankAccounts: SCHOOL_BANK_ACCOUNTS
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Helper function to check time overlap (e.g. "08:00" - "10:00" overlaps "09:00" - "11:00")
  function isTimeOverlapping(startA: string, endA: string, startB: string, endB: string): boolean {
    return startA < endB && endA > startB;
  }

  // Schedules (with Rombel, Program, Subject, Teacher, Customization & Publication Fields)
  app.get("/api/schedules", authenticateToken, async (req: any, res: any) => {
    try {
      const { rombelId, program, teacherId, day, publishedOnly } = req.query;

      let allSchedules = await db.select({
        id: schema.schedules.id,
        day: schema.schedules.day,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime,
        room: schema.schedules.room,
        learningType: schema.schedules.learningType,
        meetingLink: schema.schedules.meetingLink,
        moduleLink: schema.schedules.moduleLink,
        notes: schema.schedules.notes,
        isPublished: schema.schedules.isPublished,
        publishedAt: schema.schedules.publishedAt,
        rombelName: schema.rombel.name,
        program: schema.rombel.program,
        level: schema.rombel.level,
        isRombelPublished: schema.rombel.isSchedulePublished,
        schedulePublishNotes: schema.rombel.schedulePublishNotes,
        schedulePublishedAt: schema.rombel.schedulePublishedAt,
        subjectName: schema.subjects.name,
        subjectCode: schema.subjects.code,
        subjectCategory: schema.subjects.category,
        subjectColor: schema.subjects.color,
        kkm: schema.subjects.kkm,
        hoursPerWeek: schema.subjects.hoursPerWeek,
        teacherName: schema.users.name,
        teacherNip: schema.teachers.nip,
        teacherSpecialization: schema.teachers.specialization,
        rombelId: schema.schedules.rombelId,
        subjectId: schema.schedules.subjectId,
        teacherId: schema.schedules.teacherId,
      }).from(schema.schedules)
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .leftJoin(schema.teachers, eq(schema.schedules.teacherId, schema.teachers.id))
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id));

      if (rombelId && rombelId !== 'all') {
        allSchedules = allSchedules.filter(s => s.rombelId === parseInt(rombelId));
      }
      if (program && program !== 'all') {
        allSchedules = allSchedules.filter(s => s.program === program);
      }
      if (teacherId && teacherId !== 'all') {
        allSchedules = allSchedules.filter(s => s.teacherId === parseInt(teacherId));
      }
      if (day && day !== 'all') {
        allSchedules = allSchedules.filter(s => s.day === day);
      }
      if (publishedOnly === '1' || publishedOnly === 'true') {
        allSchedules = allSchedules.filter(s => s.isPublished && s.isRombelPublished);
      }

      // Sort by Day of Week then Start Time
      const dayOrder: Record<string, number> = {
        'Senin': 1, 'Selasa': 2, 'Rabu': 3, 'Kamis': 4, 'Jumat': 5, 'Sabtu': 6, 'Minggu': 7
      };
      allSchedules.sort((a, b) => {
        const orderA = dayOrder[a.day] || 99;
        const orderB = dayOrder[b.day] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.startTime.localeCompare(b.startTime);
      });

      res.json(allSchedules);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/schedules", authenticateToken, async (req: any, res: any) => {
    try {
      const {
        rombelId,
        subjectId,
        teacherId,
        day,
        startTime,
        endTime,
        room,
        learningType,
        meetingLink,
        moduleLink,
        notes,
        isPublished
      } = req.body;

      if (!rombelId || !subjectId || !teacherId || !day || !startTime || !endTime) {
        return res.status(400).json({ error: "Kelas, Mata Pelajaran, Guru, Hari, dan Waktu wajib diisi." });
      }

      // Check Teacher Conflict on the same day and overlapping time
      const teacherSchedules = await db.select({
        id: schema.schedules.id,
        rombelName: schema.rombel.name,
        subjectName: schema.subjects.name,
        day: schema.schedules.day,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime
      }).from(schema.schedules)
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .where(eq(schema.schedules.teacherId, parseInt(teacherId)));

      const teacherConflict = teacherSchedules.find(s =>
        s.day === day && isTimeOverlapping(startTime, endTime, s.startTime, s.endTime)
      );

      if (teacherConflict) {
        return res.status(400).json({
          error: `Jadwal bentrok: Guru yang dipilih sudah memiliki jadwal mengajar ${teacherConflict.subjectName} di ${teacherConflict.rombelName} pada ${day} pukul ${teacherConflict.startTime} - ${teacherConflict.endTime}.`
        });
      }

      // Check Room Conflict if room is specified and not virtual
      if (room && room !== 'Virtual Zoom' && room !== 'Kelas Online' && room !== 'Online') {
        const roomSchedules = await db.select({
          id: schema.schedules.id,
          rombelName: schema.rombel.name,
          subjectName: schema.subjects.name,
          day: schema.schedules.day,
          startTime: schema.schedules.startTime,
          endTime: schema.schedules.endTime,
          room: schema.schedules.room
        }).from(schema.schedules)
          .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id))
          .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
          .where(eq(schema.schedules.room, room));

        const roomConflict = roomSchedules.find(s =>
          s.day === day && isTimeOverlapping(startTime, endTime, s.startTime, s.endTime)
        );

        if (roomConflict) {
          return res.status(400).json({
            error: `Jadwal bentrok ruangan: ${room} sedang digunakan oleh ${roomConflict.rombelName} (${roomConflict.subjectName}) pada ${day} pukul ${roomConflict.startTime} - ${roomConflict.endTime}.`
          });
        }
      }

      const result = await db.insert(schema.schedules).values({
        rombelId: parseInt(rombelId),
        subjectId: parseInt(subjectId),
        teacherId: parseInt(teacherId),
        day,
        startTime,
        endTime,
        room: room || 'Ruang Kelas Utama',
        learningType: learningType || 'Tatap Muka',
        meetingLink: meetingLink || '',
        moduleLink: moduleLink || '',
        notes: notes || '',
        isPublished: isPublished !== undefined ? Boolean(isPublished) : true,
        publishedAt: isPublished ? new Date().toISOString() : null
      }).returning();

      res.json({ success: true, schedule: result[0] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/schedules/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const {
        rombelId,
        subjectId,
        teacherId,
        day,
        startTime,
        endTime,
        room,
        learningType,
        meetingLink,
        moduleLink,
        notes,
        isPublished
      } = req.body;

      if (!rombelId || !subjectId || !teacherId || !day || !startTime || !endTime) {
        return res.status(400).json({ error: "Kelas, Mata Pelajaran, Guru, Hari, dan Waktu wajib diisi." });
      }

      // Check Teacher Conflict (excluding this schedule)
      const teacherSchedules = await db.select({
        id: schema.schedules.id,
        rombelName: schema.rombel.name,
        subjectName: schema.subjects.name,
        day: schema.schedules.day,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime
      }).from(schema.schedules)
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .where(eq(schema.schedules.teacherId, parseInt(teacherId)));

      const teacherConflict = teacherSchedules.find(s =>
        s.id !== id && s.day === day && isTimeOverlapping(startTime, endTime, s.startTime, s.endTime)
      );

      if (teacherConflict) {
        return res.status(400).json({
          error: `Jadwal bentrok: Guru yang dipilih sudah memiliki jadwal mengajar ${teacherConflict.subjectName} di ${teacherConflict.rombelName} pada ${day} pukul ${teacherConflict.startTime} - ${teacherConflict.endTime}.`
        });
      }

      await db.update(schema.schedules).set({
        rombelId: parseInt(rombelId),
        subjectId: parseInt(subjectId),
        teacherId: parseInt(teacherId),
        day,
        startTime,
        endTime,
        room: room || 'Ruang Kelas Utama',
        learningType: learningType || 'Tatap Muka',
        meetingLink: meetingLink || '',
        moduleLink: moduleLink || '',
        notes: notes || '',
        isPublished: isPublished !== undefined ? Boolean(isPublished) : true,
        publishedAt: isPublished ? new Date().toISOString() : null
      }).where(eq(schema.schedules.id, id));

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/schedules/:id/links", authenticateToken, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const { meetingLink, moduleLink } = req.body;
      
      // Ensure only the assigned teacher or admin can update this
      const sched = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).get();
      if (!sched) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
      
      if (req.user.role === 'guru' && sched.teacherId !== req.user.id) {
        return res.status(403).json({ error: 'Tidak memiliki izin' });
      }

      await db.update(schema.schedules).set({
        meetingLink: meetingLink || null,
        moduleLink: moduleLink || null
      }).where(eq(schema.schedules.id, id));

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/schedules/:id", authenticateToken, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      // Clean up linked learning materials, assignments, attendances or cascade
      await db.delete(schema.learningMaterials).where(eq(schema.learningMaterials.scheduleId, id));
      await db.delete(schema.assignments).where(eq(schema.assignments.scheduleId, id));
      await db.delete(schema.attendances).where(eq(schema.attendances.scheduleId, id));
      await db.delete(schema.teacherAttendances).where(eq(schema.teacherAttendances.scheduleId, id));
      await db.delete(schema.schedules).where(eq(schema.schedules.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Publish / Unpublish Schedule for a Rombel (Publish to Students)
  app.post("/api/schedules/publish-rombel", authenticateToken, async (req: any, res: any) => {
    try {
      const { rombelId, isPublished, publishNotes } = req.body;
      if (!rombelId) {
        return res.status(400).json({ error: "ID Rombel wajib diisi." });
      }

      const publishedStatus = Boolean(isPublished);
      const publishedAt = isPublished ? new Date().toISOString() : null;
      const notes = publishNotes || (isPublished ? 'Jadwal resmi telah diverifikasi dan dipublikasikan kepada siswa.' : 'Jadwal dinonaktifkan sementara untuk penyesuaian kurikulum.');

      // Update Rombel Table
      await db.update(schema.rombel).set({
        isSchedulePublished: publishedStatus,
        schedulePublishedAt: publishedAt,
        schedulePublishNotes: notes
      }).where(eq(schema.rombel.id, parseInt(rombelId)));

      // Update all schedules in this rombel
      await db.update(schema.schedules).set({
        isPublished: publishedStatus,
        publishedAt: publishedAt
      }).where(eq(schema.schedules.rombelId, parseInt(rombelId)));

      res.json({
        success: true,
        isPublished: publishedStatus,
        publishedAt,
        publishNotes: notes
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk Publish / Unpublish by Program or Multiple Rombels
  app.post("/api/schedules/bulk-publish", authenticateToken, async (req: any, res: any) => {
    try {
      const { program, rombelIds, isPublished, publishNotes } = req.body;
      const publishedStatus = Boolean(isPublished);
      const publishedAt = isPublished ? new Date().toISOString() : null;
      const notes = publishNotes || (isPublished ? 'Jadwal resmi semester ini telah dipublikasikan secara serentak.' : 'Jadwal ditarik ke status draf.');

      let targetRombelIds: number[] = [];
      if (Array.isArray(rombelIds) && rombelIds.length > 0) {
        targetRombelIds = rombelIds.map(Number);
      } else if (program) {
        const rombels = await db.select().from(schema.rombel).where(eq(schema.rombel.program, program));
        targetRombelIds = rombels.map(r => r.id);
      } else {
        const allRombels = await db.select().from(schema.rombel);
        targetRombelIds = allRombels.map(r => r.id);
      }

      for (const rId of targetRombelIds) {
        await db.update(schema.rombel).set({
          isSchedulePublished: publishedStatus,
          schedulePublishedAt: publishedAt,
          schedulePublishNotes: notes
        }).where(eq(schema.rombel.id, rId));

        await db.update(schema.schedules).set({
          isPublished: publishedStatus,
          publishedAt: publishedAt
        }).where(eq(schema.schedules.rombelId, rId));
      }

      res.json({
        success: true,
        updatedCount: targetRombelIds.length,
        isPublished: publishedStatus
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Student Schedule View (Gets official published schedules for logged in student)
  app.get("/api/schedules/student-my-schedule", authenticateToken, async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      // Find student record
      const studentRecord = await db.select().from(schema.students).where(eq(schema.students.userId, userId));
      if (studentRecord.length === 0) {
        return res.status(404).json({ error: "Data siswa tidak ditemukan." });
      }

      const student = studentRecord[0];
      if (!student.rombelId) {
        return res.json({
          hasRombel: false,
          message: "Anda belum terdaftar dalam rombongan belajar (kelas). Silakan hubungi admin kurikulum.",
          schedules: []
        });
      }

      // Get Rombel Info
      const rombelData = await db.select().from(schema.rombel).where(eq(schema.rombel.id, student.rombelId));
      const rombel = rombelData[0] || null;

      // Get Schedules for this rombel
      const schedules = await db.select({
        id: schema.schedules.id,
        day: schema.schedules.day,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime,
        room: schema.schedules.room,
        learningType: schema.schedules.learningType,
        meetingLink: schema.schedules.meetingLink,
        moduleLink: schema.schedules.moduleLink,
        notes: schema.schedules.notes,
        isPublished: schema.schedules.isPublished,
        subjectName: schema.subjects.name,
        subjectCode: schema.subjects.code,
        subjectCategory: schema.subjects.category,
        subjectColor: schema.subjects.color,
        kkm: schema.subjects.kkm,
        teacherName: schema.users.name,
        teacherNip: schema.teachers.nip,
        teacherSpecialization: schema.teachers.specialization,
      }).from(schema.schedules)
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .leftJoin(schema.teachers, eq(schema.schedules.teacherId, schema.teachers.id))
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id))
        .where(eq(schema.schedules.rombelId, student.rombelId));

      const isPublished = Boolean(rombel?.isSchedulePublished);

      // Sort by Day of Week then Start Time
      const dayOrder: Record<string, number> = {
        'Senin': 1, 'Selasa': 2, 'Rabu': 3, 'Kamis': 4, 'Jumat': 5, 'Sabtu': 6, 'Minggu': 7
      };
      schedules.sort((a, b) => {
        const orderA = dayOrder[a.day] || 99;
        const orderB = dayOrder[b.day] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.startTime.localeCompare(b.startTime);
      });

      res.json({
        hasRombel: true,
        studentName: req.user.name,
        rombel,
        isPublished,
        publishNotes: rombel?.schedulePublishNotes,
        publishedAt: rombel?.schedulePublishedAt,
        schedules: isPublished ? schedules : [] // Only return schedules if published to students
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Teacher Schedule View (Gets all schedules assigned to logged in teacher)
  app.get("/api/schedules/teacher-my-schedule", authenticateToken, async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const teacherRecord = await db.select().from(schema.teachers).where(eq(schema.teachers.userId, userId));
      if (teacherRecord.length === 0) {
        return res.status(404).json({ error: "Data guru tidak ditemukan." });
      }

      const teacher = teacherRecord[0];
      const schedules = await db.select({
        id: schema.schedules.id,
        day: schema.schedules.day,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime,
        room: schema.schedules.room,
        learningType: schema.schedules.learningType,
        meetingLink: schema.schedules.meetingLink,
        moduleLink: schema.schedules.moduleLink,
        notes: schema.schedules.notes,
        isPublished: schema.schedules.isPublished,
        rombelId: schema.schedules.rombelId,
        rombelName: schema.rombel.name,
        program: schema.rombel.program,
        level: schema.rombel.level,
        subjectName: schema.subjects.name,
        subjectCode: schema.subjects.code,
        subjectCategory: schema.subjects.category,
        subjectColor: schema.subjects.color,
        kkm: schema.subjects.kkm,
      }).from(schema.schedules)
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .where(eq(schema.schedules.teacherId, teacher.id));

      const dayOrder: Record<string, number> = {
        'Senin': 1, 'Selasa': 2, 'Rabu': 3, 'Kamis': 4, 'Jumat': 5, 'Sabtu': 6, 'Minggu': 7
      };
      schedules.sort((a, b) => {
        const orderA = dayOrder[a.day] || 99;
        const orderB = dayOrder[b.day] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.startTime.localeCompare(b.startTime);
      });

      res.json({
        teacher,
        schedules
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Overview Matrix of Schedules & Publishing Status per Program & Rombel
  app.get("/api/schedules/overview-matrix", authenticateToken, async (req: any, res: any) => {
    try {
      const rombels = await db.select().from(schema.rombel);
      const allSchedules = await db.select({
        id: schema.schedules.id,
        rombelId: schema.schedules.rombelId,
        day: schema.schedules.day,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime,
        isPublished: schema.schedules.isPublished,
        subjectId: schema.schedules.subjectId,
        teacherId: schema.schedules.teacherId,
      }).from(schema.schedules);

      const students = await db.select().from(schema.students);

      const matrix = rombels.map(r => {
        const rSchedules = allSchedules.filter(s => s.rombelId === r.id);
        const studentCount = students.filter(s => s.rombelId === r.id).length;
        const distinctSubjects = new Set(rSchedules.map(s => s.subjectId)).size;
        const distinctTeachers = new Set(rSchedules.map(s => s.teacherId)).size;
        
        return {
          id: r.id,
          name: r.name,
          program: r.program,
          level: r.level,
          academicYear: r.academicYear || '2026/2027 Ganjil',
          isPublished: Boolean(r.isSchedulePublished),
          publishedAt: r.schedulePublishedAt,
          publishNotes: r.schedulePublishNotes,
          studentCount,
          totalSchedules: rSchedules.length,
          totalSubjects: distinctSubjects,
          totalTeachers: distinctTeachers,
        };
      });

      res.json(matrix);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Learning Materials
  app.get("/api/learning_materials", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      
      let query = db.select({
        id: schema.learningMaterials.id,
        title: schema.learningMaterials.title,
        content: schema.learningMaterials.content,
        zoomLink: schema.learningMaterials.zoomLink,
        fileUrl: schema.learningMaterials.fileUrl,
        subjectName: schema.subjects.name,
        rombelName: schema.rombel.name,
        program: schema.rombel.program,
        level: schema.rombel.level,
        teacherId: schema.schedules.teacherId,
        rombelId: schema.schedules.rombelId,
      }).from(schema.learningMaterials)
        .leftJoin(schema.schedules, eq(schema.learningMaterials.scheduleId, schema.schedules.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id));

      let materials = await query;

      if (user.role === 'siswa') {
        const student = await db.select().from(schema.students).where(eq(schema.students.userId, user.id)).limit(1);
        if (student.length > 0 && student[0].rombelId) {
          materials = materials.filter(m => m.rombelId === student[0].rombelId);
        } else {
          materials = [];
        }
      } else if (user.role === 'guru') {
        const teacher = await db.select().from(schema.teachers).where(eq(schema.teachers.userId, user.id)).limit(1);
        if (teacher.length > 0) {
          materials = materials.filter(m => m.teacherId === teacher[0].id);
        } else {
          materials = [];
        }
      }

      res.json(materials);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/learning_materials", authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
      const { scheduleId, title, content, zoomLink } = req.body;
      let fileUrl = req.body.fileUrl || '';
      
      if (req.file) {
        fileUrl = `/uploads/${req.file.filename}`;
      }

      const result = await db.insert(schema.learningMaterials).values({
        scheduleId: parseInt(scheduleId),
        title,
        content,
        zoomLink,
        fileUrl
      });
      res.json({ id: result.lastInsertRowid, success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/learning_materials/:id", authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
      const { title, content, zoomLink } = req.body;
      let fileUrl = req.body.fileUrl;
      
      if (req.file) {
        fileUrl = `/uploads/${req.file.filename}`;
      }

      const updateData: any = {
        title,
        content,
        zoomLink
      };
      
      if (fileUrl !== undefined) {
        updateData.fileUrl = fileUrl;
      }

      const result = await db.update(schema.learningMaterials)
        .set(updateData)
        .where(eq(schema.learningMaterials.id, parseInt(req.params.id)));
      
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/learning_materials/:id", authenticateToken, async (req: any, res: any) => {
    try {
      // Opt: Delete the file from the filesystem if you want, but for now just delete the record
      await db.delete(schema.learningMaterials).where(eq(schema.learningMaterials.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== ASSIGNMENTS (PENUGASAN SISWA) ====================
  // GET /api/assignments
  app.get("/api/assignments", authenticateToken, async (req: any, res: any) => {
    try {
      const user = req.user;
      
      let allAssignments = await db.select({
        id: schema.assignments.id,
        scheduleId: schema.assignments.scheduleId,
        title: schema.assignments.title,
        description: schema.assignments.description,
        deadline: schema.assignments.deadline,
        fileUrl: schema.assignments.fileUrl,
        maxScore: schema.assignments.maxScore,
        createdAt: schema.assignments.createdAt,
        subjectName: schema.subjects.name,
        subjectCode: schema.subjects.code,
        subjectColor: schema.subjects.color,
        rombelId: schema.schedules.rombelId,
        rombelName: schema.rombel.name,
        program: schema.rombel.program,
        level: schema.rombel.level,
        teacherId: schema.schedules.teacherId,
        day: schema.schedules.day,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime,
      }).from(schema.assignments)
        .leftJoin(schema.schedules, eq(schema.assignments.scheduleId, schema.schedules.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id));

      // Get teacher user name map
      const teachersWithUser = await db.select({
        teacherId: schema.teachers.id,
        teacherName: schema.users.name,
      }).from(schema.teachers)
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id));
      
      const teacherMap = new Map(teachersWithUser.map(t => [t.teacherId, t.teacherName]));

      allAssignments = allAssignments.map(a => ({
        ...a,
        teacherName: a.teacherId ? (teacherMap.get(a.teacherId) || 'Guru Pengampu') : 'Guru Pengampu'
      }));

      const allStudents = await db.select().from(schema.students);
      const allSubmissions = await db.select().from(schema.assignmentSubmissions);

      if (user.role === 'siswa') {
        const studentList = await db.select().from(schema.students).where(eq(schema.students.userId, user.id)).limit(1);
        if (studentList.length === 0 || !studentList[0].rombelId) {
          return res.json([]);
        }
        const student = studentList[0];
        
        // Filter assignments for student's rombel
        const studentAssignments = allAssignments.filter(a => a.rombelId === student.rombelId);

        // Attach mySubmission for each assignment
        const result = studentAssignments.map(a => {
          const sub = allSubmissions.find(s => s.assignmentId === a.id && s.studentId === student.id);
          return {
            ...a,
            isSubmitted: !!sub,
            mySubmission: sub ? {
              id: sub.id,
              fileUrl: sub.fileUrl,
              notes: sub.notes,
              submittedAt: sub.submittedAt,
              score: sub.score,
              feedback: sub.feedback,
              status: sub.status || 'Submitted'
            } : null
          };
        });

        return res.json(result);
      } 
      
      if (user.role === 'guru') {
        const teacherList = await db.select().from(schema.teachers).where(eq(schema.teachers.userId, user.id)).limit(1);
        if (teacherList.length === 0) {
          return res.json([]);
        }
        const teacher = teacherList[0];
        const teacherAssignments = allAssignments.filter(a => a.teacherId === teacher.id);

        const result = teacherAssignments.map(a => {
          const studentsInRombel = allStudents.filter(s => s.rombelId === a.rombelId);
          const submissionsForAss = allSubmissions.filter(s => s.assignmentId === a.id);
          const submittedStudentIds = new Set(submissionsForAss.map(s => s.studentId));
          const submittedCount = studentsInRombel.filter(s => submittedStudentIds.has(s.id)).length;
          const gradedCount = submissionsForAss.filter(s => s.score !== null && s.score !== undefined).length;
          
          return {
            ...a,
            stats: {
              totalStudents: studentsInRombel.length,
              submittedCount,
              unsubmittedCount: Math.max(0, studentsInRombel.length - submittedCount),
              gradedCount,
            }
          };
        });

        return res.json(result);
      }

      // Superadmin / Admin
      const result = allAssignments.map(a => {
        const studentsInRombel = allStudents.filter(s => s.rombelId === a.rombelId);
        const submissionsForAss = allSubmissions.filter(s => s.assignmentId === a.id);
        const submittedStudentIds = new Set(submissionsForAss.map(s => s.studentId));
        const submittedCount = studentsInRombel.filter(s => submittedStudentIds.has(s.id)).length;
        const gradedCount = submissionsForAss.filter(s => s.score !== null && s.score !== undefined).length;

        return {
          ...a,
          stats: {
            totalStudents: studentsInRombel.length,
            submittedCount,
            unsubmittedCount: Math.max(0, studentsInRombel.length - submittedCount),
            gradedCount,
          }
        };
      });

      return res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/assignments (Upload/create assignment)
  app.post("/api/assignments", authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
      if (req.user.role === 'siswa') return res.status(403).json({ error: "Siswa tidak dapat membuat tugas." });

      const { scheduleId, title, description, deadline, maxScore } = req.body;
      let fileUrl = req.body.fileUrl || '';
      
      if (req.file) {
        fileUrl = `/uploads/${req.file.filename}`;
      }

      const now = new Date();
      const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

      const result = await db.insert(schema.assignments).values({
        scheduleId: parseInt(scheduleId),
        title,
        description: description || '',
        deadline: deadline || '',
        maxScore: maxScore ? parseFloat(maxScore) : 100,
        fileUrl,
        createdAt,
      });

      res.json({ id: result.lastInsertRowid, success: true, message: "Tugas berhasil dibuat dan diunggah." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/assignments/:id (Edit assignment)
  app.put("/api/assignments/:id", authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
      if (req.user.role === 'siswa') return res.status(403).json({ error: "Forbidden" });

      const { title, description, deadline, maxScore } = req.body;
      let fileUrl = req.body.fileUrl;
      
      if (req.file) {
        fileUrl = `/uploads/${req.file.filename}`;
      }

      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (deadline !== undefined) updateData.deadline = deadline;
      if (maxScore !== undefined) updateData.maxScore = parseFloat(maxScore);
      if (fileUrl !== undefined) updateData.fileUrl = fileUrl;

      await db.update(schema.assignments)
        .set(updateData)
        .where(eq(schema.assignments.id, parseInt(req.params.id)));

      res.json({ success: true, message: "Tugas berhasil diperbarui." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/assignments/:id
  app.delete("/api/assignments/:id", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role === 'siswa') return res.status(403).json({ error: "Forbidden" });
      const assignmentId = parseInt(req.params.id);

      // Delete submissions first
      await db.delete(schema.assignmentSubmissions).where(eq(schema.assignmentSubmissions.assignmentId, assignmentId));
      await db.delete(schema.assignments).where(eq(schema.assignments.id, assignmentId));

      res.json({ success: true, message: "Tugas berhasil dihapus." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/assignments/:id/submissions (Global view for teacher / admin of all students)
  app.get("/api/assignments/:id/submissions", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role === 'siswa') return res.status(403).json({ error: "Siswa tidak diizinkan melihat rekap global siswa." });
      
      const assignmentId = parseInt(req.params.id);
      
      // Get assignment details
      const assignmentList = await db.select({
        id: schema.assignments.id,
        scheduleId: schema.assignments.scheduleId,
        title: schema.assignments.title,
        description: schema.assignments.description,
        deadline: schema.assignments.deadline,
        fileUrl: schema.assignments.fileUrl,
        maxScore: schema.assignments.maxScore,
        createdAt: schema.assignments.createdAt,
        subjectName: schema.subjects.name,
        subjectCode: schema.subjects.code,
        subjectColor: schema.subjects.color,
        rombelId: schema.schedules.rombelId,
        rombelName: schema.rombel.name,
        program: schema.rombel.program,
        level: schema.rombel.level,
        teacherId: schema.schedules.teacherId,
        day: schema.schedules.day,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime,
      }).from(schema.assignments)
        .leftJoin(schema.schedules, eq(schema.assignments.scheduleId, schema.schedules.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id))
        .where(eq(schema.assignments.id, assignmentId))
        .limit(1);

      if (assignmentList.length === 0) {
        return res.status(404).json({ error: "Tugas tidak ditemukan." });
      }

      const assignment = assignmentList[0];

      // If user is guru, verify they are the assigned teacher
      if (req.user.role === 'guru') {
        const teacher = await db.select().from(schema.teachers).where(eq(schema.teachers.userId, req.user.id)).limit(1);
        if (teacher.length === 0 || assignment.teacherId !== teacher[0].id) {
          return res.status(403).json({ error: "Anda hanya dapat melihat data tugas dan pengumpulan kelas yang Anda ampu." });
        }
      }

      // Get all students in the assigned rombel
      const studentsInRombel = await db.select({
        id: schema.students.id,
        userId: schema.students.userId,
        nisn: schema.students.nisn,
        nik: schema.students.nik,
        program: schema.students.program,
        rombelId: schema.students.rombelId,
        name: schema.users.name,
      }).from(schema.students)
        .leftJoin(schema.users, eq(schema.students.userId, schema.users.id))
        .where(eq(schema.students.rombelId, assignment.rombelId!));

      // Get all submissions for this assignment
      const submissions = await db.select().from(schema.assignmentSubmissions)
        .where(eq(schema.assignmentSubmissions.assignmentId, assignmentId));

      const subMap = new Map(submissions.map(s => [s.studentId, s]));

      // Merge students with their submissions
      const studentSubmissions = studentsInRombel.map(s => {
        const sub = subMap.get(s.id);
        return {
          studentId: s.id,
          studentName: s.name || 'Siswa',
          nisn: s.nisn || '-',
          nik: s.nik || '-',
          program: s.program || assignment.program,
          isSubmitted: !!sub,
          submission: sub ? {
            id: sub.id,
            fileUrl: sub.fileUrl,
            notes: sub.notes,
            submittedAt: sub.submittedAt,
            score: sub.score,
            feedback: sub.feedback,
            status: sub.status || (sub.score !== null ? 'Graded' : 'Submitted'),
          } : null,
        };
      });

      const totalStudents = studentSubmissions.length;
      const submittedCount = studentSubmissions.filter(s => s.isSubmitted).length;
      const unsubmittedCount = totalStudents - submittedCount;
      const gradedCount = studentSubmissions.filter(s => s.submission && s.submission.score !== null && s.submission.score !== undefined).length;
      
      const gradedScores = studentSubmissions
        .filter(s => s.submission && s.submission.score !== null && s.submission.score !== undefined)
        .map(s => s.submission!.score as number);
      
      const averageScore = gradedScores.length > 0 
        ? Math.round((gradedScores.reduce((a, b) => a + b, 0) / gradedScores.length) * 10) / 10 
        : null;

      res.json({
        assignment,
        summary: {
          totalStudents,
          submittedCount,
          unsubmittedCount,
          gradedCount,
          submissionRate: totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0,
          averageScore,
        },
        students: studentSubmissions,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/assignments/:id/submit (Student uploads/submits or updates assignment)
  app.post("/api/assignments/:id/submit", authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
      if (req.user.role !== 'siswa') return res.status(403).json({ error: "Hanya akun siswa yang dapat mengumpulkan tugas." });

      const assignmentId = parseInt(req.params.id);
      const student = await db.select().from(schema.students).where(eq(schema.students.userId, req.user.id)).limit(1);

      if (student.length === 0) {
        return res.status(404).json({ error: "Data profil siswa tidak ditemukan di database." });
      }

      const studentId = student[0].id;
      const notes = (req.body.notes || '').trim();
      let fileUrl = (req.body.fileUrl || '').trim();
      const removeFile = req.body.removeFile === 'true' || req.body.removeFile === true;

      if (req.file) {
        fileUrl = `/uploads/${req.file.filename}`;
      }

      // Check existing submission
      const existing = await db.select().from(schema.assignmentSubmissions)
        .where(and(
          eq(schema.assignmentSubmissions.assignmentId, assignmentId),
          eq(schema.assignmentSubmissions.studentId, studentId)
        )).limit(1);

      const hasExisting = existing.length > 0;
      const existingFile = hasExisting ? (existing[0].fileUrl || '') : '';
      const existingNotes = hasExisting ? (existing[0].notes || '') : '';

      // Determine final file URL
      let finalFileUrl = existingFile;
      if (fileUrl) {
        finalFileUrl = fileUrl;
      } else if (removeFile) {
        finalFileUrl = '';
      }

      // Validation: must have either a file (new or existing), a link, or notes
      if (!finalFileUrl && !notes) {
        return res.status(400).json({ error: "Harap unggah berkas tugas (file), tautan dokumen, atau tuliskan catatan jawaban tugas Anda." });
      }

      const now = new Date();
      const submittedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

      let recordId: number;

      if (hasExisting) {
        const updateObj: any = {
          fileUrl: finalFileUrl,
          notes: notes,
          submittedAt: submittedAt,
        };

        await db.update(schema.assignmentSubmissions)
          .set(updateObj)
          .where(eq(schema.assignmentSubmissions.id, existing[0].id));
        recordId = existing[0].id;
      } else {
        const insertRes = await db.insert(schema.assignmentSubmissions).values({
          assignmentId,
          studentId,
          fileUrl: finalFileUrl,
          notes,
          submittedAt,
          status: 'Submitted',
        });
        recordId = insertRes.lastInsertRowid as number;
      }

      res.json({
        success: true,
        message: hasExisting ? "Jawaban tugas berhasil diperbarui dan tersimpan resmi!" : "Tugas berhasil diunggah dan terekam secara resmi oleh sistem!",
        submission: {
          id: recordId,
          fileUrl: finalFileUrl,
          notes,
          submittedAt,
          status: hasExisting && existing[0].score !== null ? 'Graded' : 'Submitted',
          score: hasExisting ? existing[0].score : null,
          feedback: hasExisting ? existing[0].feedback : null
        }
      });
    } catch (e: any) {
      console.error("Error submitting assignment:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/assignments/submissions/:submissionId/grade (Teacher grades submission)
  app.put("/api/assignments/submissions/:submissionId/grade", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role === 'siswa') return res.status(403).json({ error: "Forbidden" });

      const submissionId = parseInt(req.params.submissionId);
      const { score, feedback, status } = req.body;

      const updateData: any = {
        status: status || 'Graded',
      };
      if (score !== undefined) updateData.score = parseFloat(score);
      if (feedback !== undefined) updateData.feedback = feedback;

      await db.update(schema.assignmentSubmissions)
        .set(updateData)
        .where(eq(schema.assignmentSubmissions.id, submissionId));

      res.json({ success: true, message: "Nilai dan masukan tugas berhasil disimpan." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Stats
  app.get("/api/stats", authenticateToken, async (req: any, res: any) => {
    try {
      const role = req.user.role;
      let stats: any = { totalStudents: 0, pendingTasks: 0, pendingInvoices: 0, todayClasses: 0 };

      // Load teachers and teacher attendances for aggregations
      const allTeacherAttendances = await db.select().from(schema.teacherAttendances);
      const allTeachersWithUsers = await db.select({
        id: schema.teachers.id,
        userId: schema.teachers.userId,
        nip: schema.teachers.nip,
        specialization: schema.teachers.specialization,
        name: schema.users.name,
      }).from(schema.teachers)
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id));

      if (role === 'superadmin' || role === 'admin' || role === 'bendahara') {
        const students = await db.select().from(schema.students);
        const pendingInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.status, 'pending'));
        const allInvoices = await db.select().from(schema.invoices);
        
        stats.totalStudents = students.length;
        stats.pendingInvoices = pendingInvoices.length;
        stats.todayClasses = 4;

        const programCounts: Record<string, number> = { 'Paket A': 0, 'Paket B': 0, 'Paket C': 0 };
        students.forEach((s: any) => {
          const prog = s.program || 'Paket C';
          if (programCounts[prog] !== undefined) programCounts[prog]++;
        });
        stats.enrollmentChartData = Object.keys(programCounts).map(k => ({ name: k, total: programCounts[k] }));

        let paidTotal = 0;
        let pendingTotal = 0;
        allInvoices.forEach((inv: any) => {
          if (inv.status === 'paid') paidTotal += inv.amount;
          else pendingTotal += inv.amount;
        });
        stats.financeChartData = [
          { name: 'Lunas', amount: paidTotal },
          { name: 'Pending', amount: pendingTotal }
        ];

        // ================= AGREGASI KEHADIRAN GURU =================
        const totalTeacherSessions = allTeacherAttendances.length;
        const totalTeacherHadir = allTeacherAttendances.filter((a: any) => a.status === 'Hadir').length;
        const totalTeacherIzin = allTeacherAttendances.filter((a: any) => a.status === 'Izin').length;
        const totalTeacherSakit = allTeacherAttendances.filter((a: any) => a.status === 'Sakit').length;
        const totalTeacherAlpa = allTeacherAttendances.filter((a: any) => a.status === 'Alpa').length;
        const teacherAttendanceRate = totalTeacherSessions > 0 
          ? Math.round((totalTeacherHadir / totalTeacherSessions) * 100) 
          : 100;

        // Breakdown per Guru
        const teacherBreakdown = allTeachersWithUsers.map(t => {
          const teacherRecords = allTeacherAttendances.filter((a: any) => a.teacherId === t.id);
          const tTotal = teacherRecords.length;
          const tHadir = teacherRecords.filter((a: any) => a.status === 'Hadir').length;
          const tIzin = teacherRecords.filter((a: any) => a.status === 'Izin').length;
          const tSakit = teacherRecords.filter((a: any) => a.status === 'Sakit').length;
          const tAlpa = teacherRecords.filter((a: any) => a.status === 'Alpa').length;
          const tRate = tTotal > 0 ? Math.round((tHadir / tTotal) * 100) : 100;
          return {
            id: t.id,
            name: t.name || 'Guru',
            nip: t.nip || '-',
            specialization: t.specialization || '-',
            total: tTotal,
            hadir: tHadir,
            izin: tIzin,
            sakit: tSakit,
            alpa: tAlpa,
            percent: tRate
          };
        });

        // Rekap Kehadiran Bulanan
        const monthlyGroups: Record<string, { hadir: number, izin: number, sakit: number, alpa: number, total: number }> = {};
        allTeacherAttendances.forEach((a: any) => {
          const monthKey = a.date.substring(0, 7); // e.g. "2026-08"
          if (!monthlyGroups[monthKey]) {
            monthlyGroups[monthKey] = { hadir: 0, izin: 0, sakit: 0, alpa: 0, total: 0 };
          }
          monthlyGroups[monthKey].total++;
          if (a.status === 'Hadir') monthlyGroups[monthKey].hadir++;
          else if (a.status === 'Izin') monthlyGroups[monthKey].izin++;
          else if (a.status === 'Sakit') monthlyGroups[monthKey].sakit++;
          else if (a.status === 'Alpa') monthlyGroups[monthKey].alpa++;
        });

        const teacherMonthlyTrend = Object.keys(monthlyGroups).sort().map(m => {
          const g = monthlyGroups[m];
          const rate = g.total > 0 ? Math.round((g.hadir / g.total) * 100) : 100;
          return {
            month: m,
            hadir: g.hadir,
            izin: g.izin,
            sakit: g.sakit,
            alpa: g.alpa,
            total: g.total,
            rate
          };
        });

        stats.teacherAttendanceStats = {
          totalSessions: totalTeacherSessions,
          totalHadir: totalTeacherHadir,
          totalIzin: totalTeacherIzin,
          totalSakit: totalTeacherSakit,
          totalAlpa: totalTeacherAlpa,
          attendanceRate: teacherAttendanceRate,
          chartData: [
            { name: 'Hadir', value: totalTeacherHadir, color: '#10b981' },
            { name: 'Izin', value: totalTeacherIzin, color: '#3b82f6' },
            { name: 'Sakit', value: totalTeacherSakit, color: '#f59e0b' },
            { name: 'Alpa', value: totalTeacherAlpa, color: '#ef4444' },
          ],
          teacherBreakdown,
          monthlyTrend: teacherMonthlyTrend
        };

      } else if (role === 'guru') {
        stats.todayClasses = 2;
        
        // Count submissions that need grading
        const currentTeacher = allTeachersWithUsers.find(t => t.userId === req.user.id);
        if (currentTeacher) {
          const teacherSchedules = await db.select().from(schema.schedules).where(eq(schema.schedules.teacherId, currentTeacher.id));
          const schIds = teacherSchedules.map(s => s.id);
          
          let pendingGrading = 0;
          if (schIds.length > 0) {
            const teacherAssignments = await db.select().from(schema.assignments);
            const myAssIds = teacherAssignments.filter(a => schIds.includes(a.scheduleId!)).map(a => a.id);
            if (myAssIds.length > 0) {
              const allSubs = await db.select().from(schema.assignmentSubmissions);
              pendingGrading = allSubs.filter(s => myAssIds.includes(s.assignmentId!) && (s.score === null || s.score === undefined)).length;
            }
          }
          stats.pendingTasks = pendingGrading;

          const myAttendances = allTeacherAttendances.filter((a: any) => a.teacherId === currentTeacher.id);
          const total = myAttendances.length;
          const hadir = myAttendances.filter((a: any) => a.status === 'Hadir').length;
          const izin = myAttendances.filter((a: any) => a.status === 'Izin').length;
          const sakit = myAttendances.filter((a: any) => a.status === 'Sakit').length;
          const alpa = myAttendances.filter((a: any) => a.status === 'Alpa').length;
          const rate = total > 0 ? Math.round((hadir / total) * 100) : 100;

          stats.teacherPersonalStats = {
            totalSessions: total,
            hadir,
            izin,
            sakit,
            alpa,
            attendanceRate: rate
          };
        } else {
          stats.pendingTasks = 0;
        }
      } else if (role === 'siswa') {
        const student = await db.select().from(schema.students).where(eq(schema.students.userId, req.user.id));
        if (student.length > 0) {
          const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.status, 'pending'));
          stats.pendingInvoices = invoices.filter((i: any) => i.studentId === student[0].id).length;

          // Count pending assignments not yet submitted
          if (student[0].rombelId) {
            const rombelSchedules = await db.select().from(schema.schedules).where(eq(schema.schedules.rombelId, student[0].rombelId));
            const rSchIds = rombelSchedules.map(s => s.id);
            const allAssignments = await db.select().from(schema.assignments);
            const relevantAssignments = allAssignments.filter(a => rSchIds.includes(a.scheduleId!));
            const mySubs = await db.select().from(schema.assignmentSubmissions).where(eq(schema.assignmentSubmissions.studentId, student[0].id));
            const submittedAssIds = new Set(mySubs.map(s => s.assignmentId));
            stats.pendingTasks = relevantAssignments.filter(a => !submittedAssIds.has(a.id)).length;
          } else {
            stats.pendingTasks = 0;
          }
        }
        stats.todayClasses = 1;
      }
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Teacher Attendance Report API (Monthly & Detailed Breakdown)
  app.get("/api/teacher-attendances/report", authenticateToken, async (req: any, res: any) => {
    try {
      const { month, teacherId } = req.query; // e.g. month: "2026-08"
      
      const allRecords = await db.select({
        id: schema.teacherAttendances.id,
        scheduleId: schema.teacherAttendances.scheduleId,
        teacherId: schema.teacherAttendances.teacherId,
        status: schema.teacherAttendances.status,
        date: schema.teacherAttendances.date,
        checkInTime: schema.teacherAttendances.checkInTime,
        teachingJournal: schema.teacherAttendances.teachingJournal,
        learningType: schema.teacherAttendances.learningType,
        proofUrl: schema.teacherAttendances.proofUrl,
        notes: schema.teacherAttendances.notes,
        teacherName: schema.users.name,
        teacherNip: schema.teachers.nip,
        teacherSpecialization: schema.teachers.specialization,
        subjectName: schema.subjects.name,
        rombelName: schema.rombel.name,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime,
        day: schema.schedules.day,
        room: schema.schedules.room,
      }).from(schema.teacherAttendances)
        .leftJoin(schema.teachers, eq(schema.teacherAttendances.teacherId, schema.teachers.id))
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id))
        .leftJoin(schema.schedules, eq(schema.teacherAttendances.scheduleId, schema.schedules.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id));

      let filteredRecords = allRecords;
      if (month) {
        filteredRecords = filteredRecords.filter((r: any) => r.date.startsWith(month as string));
      }
      if (teacherId) {
        filteredRecords = filteredRecords.filter((r: any) => r.teacherId === parseInt(teacherId as string));
      }

      // Aggregate Summary
      const totalSessions = filteredRecords.length;
      const hadir = filteredRecords.filter((r: any) => r.status === 'Hadir').length;
      const izin = filteredRecords.filter((r: any) => r.status === 'Izin').length;
      const sakit = filteredRecords.filter((r: any) => r.status === 'Sakit').length;
      const alpa = filteredRecords.filter((r: any) => r.status === 'Alpa').length;
      const attendanceRate = totalSessions > 0 ? Math.round((hadir / totalSessions) * 100) : 100;

      // Group by Teacher
      const allTeachers = await db.select({
        id: schema.teachers.id,
        nip: schema.teachers.nip,
        specialization: schema.teachers.specialization,
        name: schema.users.name,
      }).from(schema.teachers)
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id));

      const teachersSummary = allTeachers.map(t => {
        const tRecords = filteredRecords.filter((r: any) => r.teacherId === t.id);
        const tTotal = tRecords.length;
        const tHadir = tRecords.filter((r: any) => r.status === 'Hadir').length;
        const tIzin = tRecords.filter((r: any) => r.status === 'Izin').length;
        const tSakit = tRecords.filter((r: any) => r.status === 'Sakit').length;
        const tAlpa = tRecords.filter((r: any) => r.status === 'Alpa').length;
        const tRate = tTotal > 0 ? Math.round((tHadir / tTotal) * 100) : 100;
        return {
          id: t.id,
          name: t.name || 'Guru',
          nip: t.nip || '-',
          specialization: t.specialization || '-',
          total: tTotal,
          hadir: tHadir,
          izin: tIzin,
          sakit: tSakit,
          alpa: tAlpa,
          attendanceRate: tRate
        };
      });

      res.json({
        month: month || 'Semua Bulan',
        summary: {
          totalSessions,
          hadir,
          izin,
          sakit,
          alpa,
          attendanceRate
        },
        teachersSummary,
        records: filteredRecords.sort((a: any, b: any) => b.date.localeCompare(a.date))
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Dedicated Trends API with Date Range & Granularity Analytics (Daily, Weekly, Monthly)
  app.get("/api/teacher-attendances/monthly-trends", authenticateToken, async (req: any, res: any) => {
    try {
      const { teacherId, year, startDate, endDate, granularity = 'auto' } = req.query;
      const allRecords = await db.select({
        id: schema.teacherAttendances.id,
        scheduleId: schema.teacherAttendances.scheduleId,
        teacherId: schema.teacherAttendances.teacherId,
        status: schema.teacherAttendances.status,
        date: schema.teacherAttendances.date,
        teacherName: schema.users.name,
        teacherNip: schema.teachers.nip,
        subjectName: schema.subjects.name,
        rombelName: schema.rombel.name,
      }).from(schema.teacherAttendances)
        .leftJoin(schema.teachers, eq(schema.teacherAttendances.teacherId, schema.teachers.id))
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id))
        .leftJoin(schema.schedules, eq(schema.teacherAttendances.scheduleId, schema.schedules.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id));

      let filtered = allRecords;
      if (teacherId && teacherId !== 'all') {
        filtered = filtered.filter((r: any) => r.teacherId === parseInt(teacherId as string));
      }
      if (year && !startDate && !endDate) {
        filtered = filtered.filter((r: any) => r.date.startsWith(year as string));
      }
      if (startDate) {
        filtered = filtered.filter((r: any) => r.date >= (startDate as string));
      }
      if (endDate) {
        filtered = filtered.filter((r: any) => r.date <= (endDate as string));
      }

      const monthNamesIndo: Record<string, string> = {
        '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April',
        '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus',
        '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember'
      };

      const dayNamesIndo = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

      // Determine actual aggregation granularity
      let effectiveGranularity = granularity;
      if (granularity === 'auto') {
        if (startDate && endDate) {
          const d1 = new Date(startDate as string).getTime();
          const d2 = new Date(endDate as string).getTime();
          const diffDays = Math.abs(d2 - d1) / (1000 * 3600 * 24);
          if (diffDays <= 14) {
            effectiveGranularity = 'daily';
          } else if (diffDays <= 70) {
            effectiveGranularity = 'weekly';
          } else {
            effectiveGranularity = 'monthly';
          }
        } else {
          effectiveGranularity = 'monthly';
        }
      }

      const groups: Record<string, { 
        key: string, 
        label: string, 
        shortLabel: string, 
        subLabel?: string,
        hadir: number, 
        izin: number, 
        sakit: number, 
        alpa: number, 
        total: number 
      }> = {};

      filtered.forEach((r: any) => {
        let key = '';
        let label = '';
        let shortLabel = '';
        let subLabel = '';

        if (effectiveGranularity === 'daily') {
          key = r.date; // e.g. "2026-08-03"
          const d = new Date(r.date);
          const dayName = dayNamesIndo[d.getDay()] || '';
          const [, mon, day] = r.date.split('-');
          label = `${dayName}, ${parseInt(day)} ${monthNamesIndo[mon]} ${d.getFullYear()}`;
          shortLabel = `${dayName}, ${parseInt(day)} ${monthNamesIndo[mon]?.substring(0, 3)}`;
        } else if (effectiveGranularity === 'weekly') {
          // Calculate Monday of the week
          const d = new Date(r.date);
          const dayOfWeek = d.getDay();
          const distanceToMonday = (dayOfWeek + 6) % 7; // 0 for Monday, 6 for Sunday
          const monday = new Date(d);
          monday.setDate(d.getDate() - distanceToMonday);
          const sunday = new Date(monday);
          sunday.setDate(monday.getDate() + 6);

          const monStr = monday.toISOString().split('T')[0];
          const sunStr = sunday.toISOString().split('T')[0];
          key = `W-${monStr}`;
          
          const mMon = (monday.getMonth() + 1).toString().padStart(2, '0');
          const sMon = (sunday.getMonth() + 1).toString().padStart(2, '0');
          const mDay = monday.getDate().toString().padStart(2, '0');
          const sDay = sunday.getDate().toString().padStart(2, '0');

          label = `Minggu ${mDay} ${monthNamesIndo[mMon]?.substring(0, 3)} - ${sDay} ${monthNamesIndo[sMon]?.substring(0, 3)} ${sunday.getFullYear()}`;
          shortLabel = `${mDay}/${mMon} - ${sDay}/${sMon}`;
          subLabel = `${mDay} ${monthNamesIndo[mMon]?.substring(0, 3)} - ${sDay} ${monthNamesIndo[sMon]?.substring(0, 3)}`;
        } else {
          // Monthly default
          key = r.date.substring(0, 7); // e.g. "2026-08"
          const [y, mon] = key.split('-');
          label = `${monthNamesIndo[mon] || mon} ${y}`;
          shortLabel = `${(monthNamesIndo[mon] || mon).substring(0, 3)} '${y.substring(2)}`;
        }

        if (!groups[key]) {
          groups[key] = { key, label, shortLabel, subLabel, hadir: 0, izin: 0, sakit: 0, alpa: 0, total: 0 };
        }
        groups[key].total++;
        if (r.status === 'Hadir') groups[key].hadir++;
        else if (r.status === 'Izin') groups[key].izin++;
        else if (r.status === 'Sakit') groups[key].sakit++;
        else if (r.status === 'Alpa') groups[key].alpa++;
      });

      const sortedKeys = Object.keys(groups).sort();
      let prevRate = 0;
      const trends = sortedKeys.map((k, idx) => {
        const g = groups[k];
        const rate = g.total > 0 ? Math.round((g.hadir / g.total) * 100) : 100;
        const diffFromPrev = idx === 0 ? 0 : rate - prevRate;
        prevRate = rate;

        return {
          monthKey: k,
          key: k,
          label: g.label,
          shortLabel: g.shortLabel,
          subLabel: g.subLabel,
          hadir: g.hadir,
          izin: g.izin,
          sakit: g.sakit,
          alpa: g.alpa,
          total: g.total,
          rate,
          diffFromPrev
        };
      });

      // Overall aggregates
      const totalSessions = filtered.length;
      const totalHadir = filtered.filter((r: any) => r.status === 'Hadir').length;
      const totalIzin = filtered.filter((r: any) => r.status === 'Izin').length;
      const totalSakit = filtered.filter((r: any) => r.status === 'Sakit').length;
      const totalAlpa = filtered.filter((r: any) => r.status === 'Alpa').length;
      const overallRate = totalSessions > 0 ? Math.round((totalHadir / totalSessions) * 100) : 100;

      // Best and lowest periods
      const bestMonth = trends.length > 0 ? [...trends].sort((a, b) => b.rate - a.rate)[0] : null;
      const lowestMonth = trends.length > 0 ? [...trends].sort((a, b) => a.rate - b.rate)[0] : null;

      // Per-teacher breakdown with period stats
      const allTeachers = await db.select({
        id: schema.teachers.id,
        nip: schema.teachers.nip,
        specialization: schema.teachers.specialization,
        name: schema.users.name,
      }).from(schema.teachers)
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id));

      const teachersStats = allTeachers.map(t => {
        const teacherRecords = filtered.filter((r: any) => r.teacherId === t.id);
        const tTotal = teacherRecords.length;
        const tHadir = teacherRecords.filter((r: any) => r.status === 'Hadir').length;
        const tIzin = teacherRecords.filter((r: any) => r.status === 'Izin').length;
        const tSakit = teacherRecords.filter((r: any) => r.status === 'Sakit').length;
        const tAlpa = teacherRecords.filter((r: any) => r.status === 'Alpa').length;
        const tRate = tTotal > 0 ? Math.round((tHadir / tTotal) * 100) : 100;

        return {
          id: t.id,
          name: t.name || 'Guru',
          nip: t.nip || '-',
          specialization: t.specialization || '-',
          total: tTotal,
          hadir: tHadir,
          izin: tIzin,
          sakit: tSakit,
          alpa: tAlpa,
          rate: tRate
        };
      });

      res.json({
        trends,
        granularity: effectiveGranularity,
        dateRange: {
          startDate: startDate || (filtered.length > 0 ? filtered.map((r: any) => r.date).sort()[0] : null),
          endDate: endDate || (filtered.length > 0 ? filtered.map((r: any) => r.date).sort().reverse()[0] : null)
        },
        summary: {
          totalSessions,
          totalHadir,
          totalIzin,
          totalSakit,
          totalAlpa,
          overallRate,
          bestMonth,
          lowestMonth,
          activeTeachersCount: teachersStats.filter(t => t.total > 0).length,
          totalTeachersCount: teachersStats.length
        },
        teachersStats,
        distribution: [
          { name: 'Hadir', value: totalHadir, color: '#10b981' },
          { name: 'Izin', value: totalIzin, color: '#3b82f6' },
          { name: 'Sakit', value: totalSakit, color: '#f59e0b' },
          { name: 'Alpa', value: totalAlpa, color: '#ef4444' }
        ]
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Attendances
  app.get("/api/attendances", authenticateToken, async (req: any, res: any) => {
    try {
      const { scheduleId, date } = req.query;
      if (!scheduleId || !date) return res.json([]);
      const records = await db.select().from(schema.attendances)
        .where(and(
          eq(schema.attendances.scheduleId, parseInt(scheduleId as string)),
          eq(schema.attendances.date, date as string)
        ));
      res.json(records);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/attendances", authenticateToken, async (req: any, res: any) => {
    try {
      const { scheduleId, date, records } = req.body;
      
      await db.delete(schema.attendances).where(and(
        eq(schema.attendances.scheduleId, parseInt(scheduleId)),
        eq(schema.attendances.date, date)
      ));

      if (records && records.length > 0) {
        const insertData = records.map((r: any) => ({
          scheduleId: parseInt(scheduleId),
          studentId: r.studentId,
          date,
          status: r.status
        }));
        await db.insert(schema.attendances).values(insertData);
      }
      
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Teacher Attendances
  app.get("/api/teacher-attendances", authenticateToken, async (req: any, res: any) => {
    try {
      const { date, month, teacherId, scheduleId } = req.query;
      
      const records = await db.select({
        id: schema.teacherAttendances.id,
        scheduleId: schema.teacherAttendances.scheduleId,
        teacherId: schema.teacherAttendances.teacherId,
        status: schema.teacherAttendances.status,
        date: schema.teacherAttendances.date,
        checkInTime: schema.teacherAttendances.checkInTime,
        teachingJournal: schema.teacherAttendances.teachingJournal,
        learningType: schema.teacherAttendances.learningType,
        proofUrl: schema.teacherAttendances.proofUrl,
        notes: schema.teacherAttendances.notes,
        teacherName: schema.users.name,
        teacherNip: schema.teachers.nip,
        teacherSpecialization: schema.teachers.specialization,
        subjectName: schema.subjects.name,
        subjectCode: schema.subjects.code,
        subjectColor: schema.subjects.color,
        rombelName: schema.rombel.name,
        program: schema.rombel.program,
        level: schema.rombel.level,
        startTime: schema.schedules.startTime,
        endTime: schema.schedules.endTime,
        day: schema.schedules.day,
        room: schema.schedules.room,
        scheduleLearningType: schema.schedules.learningType,
        meetingLink: schema.schedules.meetingLink,
        moduleLink: schema.schedules.moduleLink,
      }).from(schema.teacherAttendances)
        .leftJoin(schema.teachers, eq(schema.teacherAttendances.teacherId, schema.teachers.id))
        .leftJoin(schema.users, eq(schema.teachers.userId, schema.users.id))
        .leftJoin(schema.schedules, eq(schema.teacherAttendances.scheduleId, schema.schedules.id))
        .leftJoin(schema.subjects, eq(schema.schedules.subjectId, schema.subjects.id))
        .leftJoin(schema.rombel, eq(schema.schedules.rombelId, schema.rombel.id));

      let filtered = records;
      if (date) {
        filtered = filtered.filter((r: any) => r.date === (date as string));
      }
      if (month) {
        filtered = filtered.filter((r: any) => r.date && r.date.startsWith(month as string));
      }
      if (teacherId) {
        filtered = filtered.filter((r: any) => r.teacherId === parseInt(teacherId as string));
      }
      if (scheduleId) {
        filtered = filtered.filter((r: any) => r.scheduleId === parseInt(scheduleId as string));
      }

      // Sort by date descending and then start time
      filtered.sort((a: any, b: any) => {
        const dateComp = (b.date || '').localeCompare(a.date || '');
        if (dateComp !== 0) return dateComp;
        return (b.checkInTime || '').localeCompare(a.checkInTime || '');
      });

      res.json(filtered);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Real-time Check-in / Absen Mengajar Guru
  app.post("/api/teacher-attendances/check-in", authenticateToken, upload.single('proofFile'), async (req: any, res: any) => {
    try {
      let { scheduleId, teacherId, status = 'Hadir', date, checkInTime, teachingJournal, learningType = 'Tatap Muka', proofUrl, notes } = req.body;
      
      if (!date) {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        date = `${year}-${month}-${day}`;
      }

      if (!checkInTime) {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        checkInTime = `${hours}:${minutes}:${seconds}`;
      }

      if (req.file) {
        proofUrl = `/uploads/${req.file.filename}`;
      }

      // Resolve teacherId if user is role guru and teacherId not provided
      if (!teacherId && req.user) {
        const teacherRec = await db.select().from(schema.teachers).where(eq(schema.teachers.userId, req.user.id)).limit(1);
        if (teacherRec.length > 0) {
          teacherId = teacherRec[0].id;
        }
      }

      // Resolve teacherId from schedule if still missing
      if (!teacherId && scheduleId) {
        const schRec = await db.select().from(schema.schedules).where(eq(schema.schedules.id, parseInt(scheduleId))).limit(1);
        if (schRec.length > 0) {
          teacherId = schRec[0].teacherId;
        }
      }

      if (!teacherId || !scheduleId) {
        return res.status(400).json({ error: "Data jadwal atau guru tidak valid." });
      }

      const schIdNum = parseInt(scheduleId);
      const teacherIdNum = parseInt(teacherId);

      // Check if already checked in today for this schedule
      const existing = await db.select().from(schema.teacherAttendances)
        .where(and(
          eq(schema.teacherAttendances.scheduleId, schIdNum),
          eq(schema.teacherAttendances.teacherId, teacherIdNum),
          eq(schema.teacherAttendances.date, date)
        )).limit(1);

      let recordId: any;
      if (existing.length > 0) {
        const updateData: any = {
          status,
          checkInTime,
          teachingJournal: teachingJournal !== undefined ? teachingJournal : existing[0].teachingJournal,
          learningType: learningType || existing[0].learningType || 'Tatap Muka',
          notes: notes !== undefined ? notes : existing[0].notes,
        };
        if (proofUrl) updateData.proofUrl = proofUrl;

        await db.update(schema.teacherAttendances)
          .set(updateData)
          .where(eq(schema.teacherAttendances.id, existing[0].id));
        recordId = existing[0].id;
      } else {
        const insertRes = await db.insert(schema.teacherAttendances).values({
          scheduleId: schIdNum,
          teacherId: teacherIdNum,
          status,
          date,
          checkInTime,
          teachingJournal: teachingJournal || '',
          learningType: learningType || 'Tatap Muka',
          proofUrl: proofUrl || '',
          notes: notes || '',
        });
        recordId = insertRes.lastInsertRowid;
      }

      res.json({
        success: true,
        message: "Presensi kehadiran mengajar berhasil dicatat secara realtime!",
        record: {
          id: recordId,
          scheduleId: schIdNum,
          teacherId: teacherIdNum,
          date,
          checkInTime,
          status,
          teachingJournal,
          learningType,
          proofUrl,
          notes
        }
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/teacher-attendances", authenticateToken, async (req: any, res: any) => {
    try {
      const { date, records } = req.body;
      
      await db.delete(schema.teacherAttendances).where(eq(schema.teacherAttendances.date, date));

      if (records && records.length > 0) {
        const now = new Date();
        const defaultTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        
        const insertData = records.map((r: any) => ({
          scheduleId: r.scheduleId,
          teacherId: r.teacherId,
          date,
          status: r.status || 'Hadir',
          checkInTime: r.checkInTime || defaultTime,
          teachingJournal: r.teachingJournal || 'Pembahasan materi pembelajaran sesuai kurikulum',
          learningType: r.learningType || 'Tatap Muka',
          proofUrl: r.proofUrl || '',
          notes: r.notes || '',
        }));
        await db.insert(schema.teacherAttendances).values(insertData);
      }
      
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Settings
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await db.select().from(schema.siteSettings);
      const settingsMap = settings.reduce((acc: any, curr) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {});
      res.json(settingsMap);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/settings", authenticateToken, async (req, res) => {
    try {
      const updates = req.body;
      for (const [key, value] of Object.entries(updates)) {
        await db.insert(schema.siteSettings).values({ key, value: String(value) }).onConflictDoUpdate({
          target: schema.siteSettings.key,
          set: { value: String(value) }
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mock WA Gateway
  app.post("/api/wa-gateway/send", authenticateToken, async (req, res) => {
    try {
      const { phone, message } = req.body;
      console.log(`[WA Gateway] Sending to ${phone}: ${message}`);
      res.json({ success: true, message: "WhatsApp sent" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== USER MANAGEMENT (CRUD FOR SUPERADMIN & ADMIN) ====================
  app.get("/api/users", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Akses ditolak" });
      }

      const allUsers = await db.select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
        name: schema.users.name,
        password: schema.users.password,
        financeAccess: schema.users.financeAccess,
        rombelAccess: schema.users.rombelAccess,
      }).from(schema.users);

      const allStudents = await db.select({
        id: schema.students.id,
        userId: schema.students.userId,
        nis: schema.students.nis,
        nisn: schema.students.nisn,
        nik: schema.students.nik,
        program: schema.students.program,
        rombelId: schema.students.rombelId,
        rombelName: schema.rombel.name,
        birthDate: schema.students.birthDate,
        address: schema.students.address
      }).from(schema.students)
        .leftJoin(schema.rombel, eq(schema.students.rombelId, schema.rombel.id));

      const allTeachers = await db.select({
        id: schema.teachers.id,
        userId: schema.teachers.userId,
        nip: schema.teachers.nip,
        specialization: schema.teachers.specialization
      }).from(schema.teachers);

      const studentMap = new Map(allStudents.map(s => [s.userId, s]));
      const teacherMap = new Map(allTeachers.map(t => [t.userId, t]));

      const enrichedUsers = allUsers.map(u => {
        const studentInfo = studentMap.get(u.id);
        const teacherInfo = teacherMap.get(u.id);
        return {
          ...u,
          financeAccess: Boolean(u.financeAccess) || u.role === 'superadmin' || u.role === 'bendahara',
          rombelAccess: u.role === 'superadmin' || u.role === 'admin' || Boolean(u.rombelAccess),
          rawRombelAccess: Boolean(u.rombelAccess),
          studentProfile: studentInfo ? {
            id: studentInfo.id,
            nis: studentInfo.nis || '-',
            nisn: studentInfo.nisn || '-',
            nik: studentInfo.nik || '-',
            program: studentInfo.program || 'Paket C',
            rombelId: studentInfo.rombelId,
            rombelName: studentInfo.rombelName || 'Belum Ditentukan',
            birthDate: studentInfo.birthDate || '',
            address: studentInfo.address || ''
          } : null,
          teacherProfile: teacherInfo ? {
            id: teacherInfo.id,
            nip: teacherInfo.nip || '-',
            specialization: teacherInfo.specialization || '-'
          } : null
        };
      });

      res.json(enrichedUsers);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Create User (Superadmin Full Access, Admin can create guru/siswa)
  app.post("/api/users", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Anda tidak memiliki wewenang untuk membuat akun pengguna." });
      }

      const {
        name,
        username,
        password,
        role,
        financeAccess,
        rombelAccess,
        nip,
        specialization,
        nis,
        nisn,
        nik,
        program,
        rombelId,
        birthDate,
        address
      } = req.body;

      if (!name || !username || !password || !role) {
        return res.status(400).json({ error: "Nama lengkap, username, password, dan peran wajib diisi." });
      }

      const validRoles = ['superadmin', 'admin', 'bendahara', 'guru', 'siswa'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "Peran pengguna tidak valid." });
      }

      // Non-superadmin cannot create superadmin, admin, or bendahara accounts
      if (req.user.role !== 'superadmin' && (role === 'superadmin' || role === 'admin' || role === 'bendahara')) {
        return res.status(403).json({ error: "Hanya Superadmin yang berwenang membuat akun dengan peran Superadmin, Admin, atau Bendahara." });
      }

      // Check username uniqueness
      const existingUser = await db.select().from(schema.users).where(eq(schema.users.username, username.trim())).limit(1);
      if (existingUser.length > 0) {
        return res.status(400).json({ error: `Username "${username.trim()}" sudah terdaftar. Silakan pilih username yang lain.` });
      }

      const isFinanceAllowed = (role === 'superadmin' || role === 'bendahara') ? true : (req.user.role === 'superadmin' ? Boolean(financeAccess) : false);
      const isRombelAllowed = (role === 'superadmin' || role === 'admin') ? true : (req.user.role === 'superadmin' ? Boolean(rombelAccess) : false);

      const newUser = await db.insert(schema.users).values({
        name: name.trim(),
        username: username.trim(),
        password: password.trim(),
        role,
        financeAccess: isFinanceAllowed,
        rombelAccess: isRombelAllowed
      }).returning();

      const createdUserId = newUser[0].id;

      // Auto-create teacher profile if role is 'guru'
      if (role === 'guru') {
        await db.insert(schema.teachers).values({
          userId: createdUserId,
          nip: nip?.trim() || '',
          specialization: specialization?.trim() || 'Umum'
        });
      }

      // Auto-create student profile if role is 'siswa'
      if (role === 'siswa') {
        await db.insert(schema.students).values({
          userId: createdUserId,
          nis: nis?.trim() || `2401${Math.floor(100 + Math.random() * 900)}`,
          nisn: nisn?.trim() || '',
          nik: nik?.trim() || '',
          program: program || 'Paket C',
          rombelId: rombelId ? parseInt(rombelId) : null,
          birthDate: birthDate || '',
          address: address?.trim() || ''
        });
      }

      res.json({
        success: true,
        user: newUser[0],
        message: `Akun baru "${name.trim()}" dengan peran ${role} berhasil dibuat.`
      });
    } catch (e: any) {
      console.error("Error creating user:", e);
      res.status(500).json({ error: e.message || "Gagal membuat akun pengguna." });
    }
  });

  // PUT: Update User (Superadmin Full Access, Admin with constraints)
  app.put("/api/users/:id", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Akses ditolak" });
      }

      const targetId = parseInt(req.params.id);
      const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, targetId)).limit(1);
      if (targetUser.length === 0) {
        return res.status(404).json({ error: "Pengguna tidak ditemukan." });
      }

      // Admin cannot modify Superadmin account
      if (req.user.role === 'admin' && targetUser[0].role === 'superadmin') {
        return res.status(403).json({ error: "Admin tidak berwenang mengubah akun Superadmin." });
      }

      const {
        username,
        password,
        name,
        role,
        financeAccess,
        rombelAccess,
        nip,
        specialization,
        nis,
        nisn,
        nik,
        program,
        rombelId,
        birthDate,
        address
      } = req.body;

      // Check username uniqueness if changed
      if (username && username.trim() !== targetUser[0].username) {
        const checkDuplicate = await db.select().from(schema.users).where(eq(schema.users.username, username.trim())).limit(1);
        if (checkDuplicate.length > 0 && checkDuplicate[0].id !== targetId) {
          return res.status(400).json({ error: `Username "${username.trim()}" sudah digunakan oleh akun lain.` });
        }
      }

      // Check role demotion on self
      if (targetId === req.user.id && targetUser[0].role === 'superadmin' && role && role !== 'superadmin') {
        return res.status(400).json({ error: "Anda tidak dapat menurunkan peran Superadmin pada akun Anda sendiri." });
      }

      const updateData: any = {};
      if (username) updateData.username = username.trim();
      if (password) updateData.password = password.trim();
      if (name) updateData.name = name.trim();

      // Only Superadmin can change roles and finance/rombel access
      if (req.user.role === 'superadmin') {
        if (role && ['superadmin', 'admin', 'bendahara', 'guru', 'siswa'].includes(role)) {
          updateData.role = role;
        }
        if (financeAccess !== undefined) {
          updateData.financeAccess = (role === 'superadmin' || role === 'bendahara' || targetUser[0].role === 'superadmin' || targetUser[0].role === 'bendahara') ? true : Boolean(financeAccess);
        }
        if (rombelAccess !== undefined) {
          updateData.rombelAccess = (role === 'superadmin' || role === 'admin' || targetUser[0].role === 'superadmin' || targetUser[0].role === 'admin') ? true : Boolean(rombelAccess);
        }
      }

      const updatedUser = await db.update(schema.users).set(updateData).where(eq(schema.users.id, targetId)).returning();
      const currentRole = updateData.role || targetUser[0].role;

      // Sync teacher profile
      if (currentRole === 'guru') {
        const teacherRec = await db.select().from(schema.teachers).where(eq(schema.teachers.userId, targetId)).limit(1);
        if (teacherRec.length > 0) {
          await db.update(schema.teachers).set({
            nip: nip !== undefined ? (nip?.trim() || '') : teacherRec[0].nip,
            specialization: specialization !== undefined ? (specialization?.trim() || '') : teacherRec[0].specialization
          }).where(eq(schema.teachers.userId, targetId));
        } else {
          await db.insert(schema.teachers).values({
            userId: targetId,
            nip: nip?.trim() || '',
            specialization: specialization?.trim() || 'Umum'
          });
        }
      }

      // Sync student profile
      if (currentRole === 'siswa') {
        const studentRec = await db.select().from(schema.students).where(eq(schema.students.userId, targetId)).limit(1);
        if (studentRec.length > 0) {
          await db.update(schema.students).set({
            nis: nis !== undefined ? (nis?.trim() || studentRec[0].nis) : studentRec[0].nis,
            nisn: nisn !== undefined ? (nisn?.trim() || studentRec[0].nisn) : studentRec[0].nisn,
            nik: nik !== undefined ? (nik?.trim() || studentRec[0].nik) : studentRec[0].nik,
            program: program !== undefined ? (program || studentRec[0].program) : studentRec[0].program,
            rombelId: rombelId !== undefined ? (rombelId ? parseInt(rombelId) : null) : studentRec[0].rombelId,
            birthDate: birthDate !== undefined ? (birthDate || studentRec[0].birthDate) : studentRec[0].birthDate,
            address: address !== undefined ? (address?.trim() || studentRec[0].address) : studentRec[0].address,
          }).where(eq(schema.students.userId, targetId));
        } else {
          await db.insert(schema.students).values({
            userId: targetId,
            nis: nis?.trim() || `2401${Math.floor(100 + Math.random() * 900)}`,
            nisn: nisn?.trim() || '',
            nik: nik?.trim() || '',
            program: program || 'Paket C',
            rombelId: rombelId ? parseInt(rombelId) : null,
            birthDate: birthDate || '',
            address: address?.trim() || ''
          });
        }
      }

      res.json({ success: true, user: updatedUser[0], message: "Data akun dan izin akses berhasil diperbarui." });
    } catch (e: any) {
      console.error("Error updating user:", e);
      res.status(500).json({ error: e.message || "Gagal memperbarui akun pengguna." });
    }
  });

  // DELETE: Delete User (Superadmin Full Access)
  app.delete("/api/users/:id", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'superadmin') {
        return res.status(403).json({ error: "Hanya Superadmin yang memiliki wewenang untuk menghapus akun pengguna secara permanen." });
      }

      const targetId = parseInt(req.params.id);

      // Prevent self-deletion
      if (req.user.id === targetId) {
        return res.status(400).json({ error: "Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif digunakan saat ini." });
      }

      const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, targetId)).limit(1);
      if (targetUser.length === 0) {
        return res.status(404).json({ error: "Akun pengguna tidak ditemukan." });
      }

      // Prevent deleting the last superadmin
      if (targetUser[0].role === 'superadmin') {
        const allSuperadmins = await db.select().from(schema.users).where(eq(schema.users.role, 'superadmin'));
        if (allSuperadmins.length <= 1) {
          return res.status(400).json({ error: "Tidak dapat menghapus satu-satunya akun Superadmin yang ada pada sistem." });
        }
      }

      // 1. Clean up student dependencies if exists
      const studentRec = await db.select().from(schema.students).where(eq(schema.students.userId, targetId)).limit(1);
      if (studentRec.length > 0) {
        const sId = studentRec[0].id;
        await db.delete(schema.attendances).where(eq(schema.attendances.studentId, sId));
        await db.delete(schema.assignmentSubmissions).where(eq(schema.assignmentSubmissions.studentId, sId));

        const studentInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.studentId, sId));
        for (const inv of studentInvoices) {
          await db.delete(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv.id));
        }
        await db.delete(schema.invoices).where(eq(schema.invoices.studentId, sId));
        await db.delete(schema.students).where(eq(schema.students.id, sId));
      }

      // 2. Clean up teacher dependencies if exists
      const teacherRec = await db.select().from(schema.teachers).where(eq(schema.teachers.userId, targetId)).limit(1);
      if (teacherRec.length > 0) {
        const tId = teacherRec[0].id;
        await db.delete(schema.teacherAttendances).where(eq(schema.teacherAttendances.teacherId, tId));
        // Dissociate teacher from schedules to avoid breaking schedule records
        await db.update(schema.schedules).set({ teacherId: null }).where(eq(schema.schedules.teacherId, tId));
        await db.delete(schema.teachers).where(eq(schema.teachers.id, tId));
      }

      // 3. Delete from users table
      await db.delete(schema.users).where(eq(schema.users.id, targetId));

      res.json({
        success: true,
        message: `Akun "${targetUser[0].name}" (${targetUser[0].username}) dengan peran [${targetUser[0].role}] berhasil dihapus.`
      });
    } catch (e: any) {
      console.error("Error deleting user:", e);
      res.status(500).json({ error: e.message || "Gagal menghapus akun pengguna." });
    }
  });

  // Toggle Finance Access (Superadmin only)
  app.post("/api/users/:id/toggle-finance", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'superadmin') {
        return res.status(403).json({ error: "Hanya Superadmin yang dapat mengubah hak akses keuangan." });
      }
      const userId = parseInt(req.params.id);
      const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      if (targetUser.length === 0) {
        return res.status(404).json({ error: "User tidak ditemukan" });
      }

      if (targetUser[0].role === 'superadmin' || targetUser[0].role === 'bendahara') {
        return res.status(400).json({ error: "Akun Superadmin & Bendahara secara permanen memiliki akses penuh ke seluruh modul keuangan." });
      }

      const nextVal = !Boolean(targetUser[0].financeAccess);
      await db.update(schema.users).set({ financeAccess: nextVal }).where(eq(schema.users.id, userId));

      res.json({
        success: true,
        financeAccess: nextVal,
        message: nextVal ? `Hak akses Manajemen Keuangan untuk "${targetUser[0].name}" telah diaktifkan.` : `Hak akses Manajemen Keuangan untuk "${targetUser[0].name}" telah dinonaktifkan.`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Toggle Rombel Access (Superadmin only)
  app.post("/api/users/:id/toggle-rombel", authenticateToken, async (req: any, res: any) => {
    try {
      if (req.user.role !== 'superadmin') {
        return res.status(403).json({ error: "Hanya Superadmin yang dapat memberikan atau mencabut izin kelola Rombel." });
      }
      const userId = parseInt(req.params.id);
      const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      if (targetUser.length === 0) {
        return res.status(404).json({ error: "User tidak ditemukan" });
      }

      if (targetUser[0].role === 'superadmin' || targetUser[0].role === 'admin') {
        return res.status(400).json({ error: "Akun Superadmin & Admin secara permanen memiliki wewenang kelola Rombel." });
      }

      const nextVal = !Boolean(targetUser[0].rombelAccess);
      await db.update(schema.users).set({ rombelAccess: nextVal }).where(eq(schema.users.id, userId));

      res.json({
        success: true,
        rombelAccess: nextVal,
        message: nextVal ? `Izin Kelola Rombel untuk "${targetUser[0].name}" (${targetUser[0].role}) telah diberikan oleh Superadmin.` : `Izin Kelola Rombel untuk "${targetUser[0].name}" telah dicabut.`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
