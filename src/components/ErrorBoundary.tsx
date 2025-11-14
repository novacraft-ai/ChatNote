import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{ 
            padding: '20px', 
            textAlign: 'center', 
            color: '#666',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{ maxWidth: '400px' }}>
              <h3 style={{ marginBottom: '10px' }}>PDF Viewer Temporarily Unavailable</h3>
              <p style={{ marginBottom: '20px' }}>
                There's a configuration issue with the PDF viewer. The rest of the app is working fine!
              </p>
              <p style={{ fontSize: '12px', color: '#999', marginBottom: '20px' }}>
                Error: {this.state.error?.message || 'Unknown error'}
              </p>
              <div style={{ marginTop: '20px' }}>
                <label 
                  htmlFor="pdf-upload-fallback" 
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '16px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    display: 'inline-block'
                  }}
                >
                  Upload PDF (Basic)
                </label>
                <input
                  id="pdf-upload-fallback"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      alert(`PDF "${file.name}" selected. PDF viewing will work once the configuration issue is resolved.`)
                    }
                  }}
                  style={{ display: 'none' }}
                />
              </div>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                style={{
                  marginTop: '15px',
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        )
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary

