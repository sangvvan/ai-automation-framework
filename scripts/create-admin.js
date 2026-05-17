import pg from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL || 'postgresql://blogengine:blogengine@localhost:5432/blogengine';
const pool = new pg.Pool({ connectionString });

async function create() {
  try {
    const hash = await bcrypt.hash('password123', 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, status, role, locale) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, status = $4`,
      ['admin@example.com', hash, 'Admin User', 'active', 'admin', 'en']
    );
    console.log('User created: admin@example.com / password123');
  } catch (err) {
    console.error('Error creating user:', err);
  } finally {
    await pool.end();
  }
}
create();
