package logfile

import (
	"bufio"
	"os"
	"path/filepath"
)

// Recorder appends entries to a long CSV (timestamp_ms,id,signal,value), the
// same format WriteCSV makes from a .bin log, so Load opens it like a
// converted SD-card log: values are stored raw and calibrated on load.
type Recorder struct {
	f    *os.File
	w    *bufio.Writer
	path string
	line []byte
}

// CreateRecording creates dir if needed and starts a new file named name in it.
// It fails rather than overwrite an existing file.
func CreateRecording(dir, name string) (*Recorder, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, name)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return nil, err
	}
	r := &Recorder{f: f, w: bufio.NewWriterSize(f, 64<<10), path: path}
	if _, err := r.w.WriteString(longHeader); err != nil {
		f.Close()
		return nil, err
	}
	return r, nil
}

func (r *Recorder) Path() string { return r.path }

// Write buffers one entry; call Flush to put buffered entries on disk.
func (r *Recorder) Write(e LogEntry, name string) error {
	r.line = appendLongRow(r.line[:0], e, name)
	_, err := r.w.Write(r.line)
	return err
}

func (r *Recorder) Flush() error { return r.w.Flush() }

// Close flushes and closes the file. The file is kept even if it holds only the header.
func (r *Recorder) Close() error {
	err := r.w.Flush()
	if cerr := r.f.Close(); err == nil {
		err = cerr
	}
	return err
}
