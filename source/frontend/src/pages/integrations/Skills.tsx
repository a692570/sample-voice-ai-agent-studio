import { useState, useEffect, useCallback, useRef } from 'react';
import { listSkills, createSkill, deleteSkill, uploadSkillFile } from '../../services/skillsApi';
import type { Skill } from '../../services/skillsApi';
import { useAuth } from '../../context/AuthContext';
import { useFilter } from '../../context/FilterContext';
import styles from './Tools.module.css';

type TabType = 'github' | 'upload';

function Skills() {
  const { user } = useAuth();
  const { showOnlyMine } = useFilter();
  const [activeTab, setActiveTab] = useState<TabType>('github');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // GitHub form
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formPath, setFormPath] = useState('');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listSkills();
      setSkills(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleAddGithub = async () => {
    if (!formName.trim() || !formUrl.trim()) return;
    try {
      const newSkill = await createSkill({
        name: formName.trim(),
        description: formDescription.trim(),
        source: 'git',
        url: formUrl.trim(),
        path: formPath.trim() || undefined,
      });
      setSkills((prev) => [newSkill, ...prev]);
      resetForm();
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { s3Uri, key } = await uploadSkillFile(file);
      // Derive name from filename
      const name = file.name.replace(/\.md$/i, '').replace(/[_-]/g, ' ');
      const newSkill = await createSkill({
        name,
        description: `Uploaded from ${file.name}`,
        source: 's3',
        path: key,
        s3Uri,
      });
      setSkills((prev) => [newSkill, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload skill');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormUrl('');
    setFormPath('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Skills</h1>
          <p className={styles.subtitle}>
            Add SKILL.md files your agent can use as tools at runtime via AgentCore Harness.
          </p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + Add Skill
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontSize: '13px', marginBottom: '16px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '12px', background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'github' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('github')}
        >
          GitHub
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'upload' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          Upload (S3)
        </button>
      </div>

      {/* Add Form - GitHub Tab */}
      {showAdd && activeTab === 'github' && (
        <div className={styles.addForm}>
          <h3 className={styles.formTitle}>Add Skill from GitHub</h3>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Name *</label>
              <input
                className={styles.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. order-lookup-skill"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Description</label>
              <input
                className={styles.input}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What does this skill do?"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Git Repository URL *</label>
              <input
                className={styles.input}
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Path (subdirectory, optional)</label>
              <input
                className={styles.input}
                value={formPath}
                onChange={(e) => setFormPath(e.target.value)}
                placeholder="skills/order-lookup"
              />
            </div>
          </div>
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={() => { setShowAdd(false); resetForm(); }}>
              Cancel
            </button>
            <button
              className={styles.submitBtn}
              onClick={handleAddGithub}
              disabled={!formName.trim() || !formUrl.trim()}
            >
              Add Skill
            </button>
          </div>
        </div>
      )}

      {/* Add Form - Upload Tab */}
      {showAdd && activeTab === 'upload' && (
        <div className={styles.addForm}>
          <h3 className={styles.formTitle}>Upload SKILL.md File</h3>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#6366f1' : '#e2e8f0'}`,
              borderRadius: '10px',
              padding: '40px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? '#eef2ff' : '#f8fafc',
              transition: 'all 0.2s',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p style={{ fontSize: '14px', color: '#475569', margin: 0 }}>
              {uploading ? 'Uploading...' : 'Drop a SKILL.md file here or click to browse'}
            </p>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px' }}>
              Supports .md files (AgentSkills.io standard)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />
          </div>
          <div className={styles.formActions} style={{ marginTop: '12px' }}>
            <button className={styles.cancelBtn} onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Skills List */}
      {loading ? (
        <div className={styles.emptyState}><p>Loading skills...</p></div>
      ) : skills.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No skills added yet. Use "+ Add Skill" to add a SKILL.md from GitHub or upload one.</p>
        </div>
      ) : (
        <div className={styles.toolList}>
          {skills.filter((s) => !showOnlyMine || !user?.email || !s.userEmail || s.userEmail === user.email).map((skill) => (
            <div key={skill.id} className={styles.toolCard}>
              <div className={styles.toolHeader}>
                <h3 className={styles.toolName} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                  {skill.name}
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: skill.source === 'git' ? '#f0fdf4' : '#eef2ff',
                    color: skill.source === 'git' ? '#16a34a' : '#6366f1',
                    border: `1px solid ${skill.source === 'git' ? '#bbf7d0' : '#c7d2fe'}`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {skill.source === 'git' ? 'GitHub' : 'S3'}
                  </span>
                </h3>
                <button className={styles.deleteBtn} onClick={() => handleDelete(skill.id)}>Delete</button>
              </div>
              {skill.description && <p className={styles.toolDesc}>{skill.description}</p>}
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {skill.source === 'git' && skill.url && (
                  <span>{skill.url}{skill.path ? ` → ${skill.path}` : ''}</span>
                )}
                {skill.source === 's3' && skill.s3Uri && (
                  <span>{skill.s3Uri}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Skills;
