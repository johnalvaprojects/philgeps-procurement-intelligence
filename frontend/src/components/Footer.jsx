import { useEffect, useRef } from 'react'
import LineHoverText from './LineHoverText.jsx'

const GITHUB_URL = 'https://github.com/johnalvaprojects'
const PROJECTS_URL = 'https://github.com/johnalvaprojects'

const LINKS = [
  { label: 'Github', href: GITHUB_URL, external: true },
  { label: 'More projects', href: PROJECTS_URL, external: true },
  { label: 'Back to top', href: '#top', external: false },
]

export default function Footer() {
  const footerRef = useRef(null)
  const labels = useRef({})

  useEffect(() => {
    const footer = footerRef.current
    const sentinel = document.querySelector('.footer-reveal-sentinel')
    if (!footer || !sentinel) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      footer.classList.add('is-in')
      observer.disconnect()
    }, { threshold: 0.01, rootMargin: '0px 0px -12% 0px' })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return (
    <footer className="colophon" ref={footerRef}>
      <div className="colophon-info">
        <div className="colophon-col">
          <p className="mono">Personal project / 2026</p>
          <div className="colophon-group">
            <p className="mono colophon-label">Built by</p>
            <p className="mono colophon-name">John Solomon M. Alvarez</p>
          </div>
          <p className="mono">IT student / developer</p>
        </div>
        <div className="colophon-col">
          <p className="mono colophon-label">Project</p>
          <p className="mono">
            Philgeps procurement
            <br />
            Intelligence tool
          </p>
          <p className="mono">
            Node.js / Express
            <br />
            React / Vite
          </p>
        </div>
        <div className="colophon-col">
          <p className="mono colophon-label">Links</p>
          {LINKS.map((link) => (
            <a
              key={link.label}
              className={link.href === '#top' ? 'mono colophon-link is-top' : 'mono colophon-link'}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              onMouseEnter={() => labels.current[link.label]?.play()}
              onFocus={() => labels.current[link.label]?.play()}
            >
              <LineHoverText
                ref={(node) => {
                  labels.current[link.label] = node
                }}
                text={link.label}
              />
              <span className="colophon-arrow" aria-hidden="true">{link.href === '#top' ? '↑' : '↗'}</span>
            </a>
          ))}
        </div>
      </div>
      <hr className="colophon-rule" />
      <p className="colophon-mark">Johnalvaproject</p>
      <div className="colophon-micro">
        <p className="mono">© 2026 John Solomon M. Alvarez</p>
        <p className="mono">Personal project</p>
      </div>
    </footer>
  )
}
