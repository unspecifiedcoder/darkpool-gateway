"use client"

import { useEffect, useRef } from "react"

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const stars: Array<{
      x: number
      y: number
      z: number
      prevX: number
      prevY: number
    }> = []

    // Create stars
    for (let i = 0; i < 800; i++) {
      stars.push({
        x: Math.random() * canvas.width - canvas.width / 2,
        y: Math.random() * canvas.height - canvas.height / 2,
        z: Math.random() * 1000,
        prevX: 0,
        prevY: 0,
      })
    }

    const particles: Array<{
      x: number
      y: number
      vx: number
      vy: number
      life: number
      maxLife: number
    }> = []

    // Create floating particles
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        life: Math.random() * 100,
        maxLife: 100,
      })
    }

    const speed = 0.5

    function animate() {
      if (!ctx || !canvas) return

      ctx.fillStyle = "rgba(10, 10, 15, 0.1)"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      // Draw stars
      stars.forEach((star) => {
        star.z -= speed
        if (star.z <= 0) {
          star.x = Math.random() * canvas.width - canvas.width / 2
          star.y = Math.random() * canvas.height - canvas.height / 2
          star.z = 1000
        }

        const x = (star.x / star.z) * 100 + centerX
        const y = (star.y / star.z) * 100 + centerY

        const opacity = (1 - star.z / 1000) * 0.2
        const size = (1 - star.z / 1000) * 2

        ctx.beginPath()
        ctx.fillStyle = `rgba(0, 246, 255, ${opacity})`
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()

        // Draw trail
        if (star.prevX && star.prevY) {
          ctx.beginPath()
          ctx.strokeStyle = `rgba(0, 246, 255, ${opacity * 0.5})`
          ctx.lineWidth = size
          ctx.moveTo(star.prevX, star.prevY)
          ctx.lineTo(x, y)
          ctx.stroke()
        }

        star.prevX = x
        star.prevY = y
      })

      // Draw floating particles
      particles.forEach((particle, index) => {
        particle.x += particle.vx
        particle.y += particle.vy
        particle.life--

        if (particle.life <= 0) {
          particles[index] = {
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            life: 100,
            maxLife: 100,
          }
        }

        const opacity = (particle.life / particle.maxLife) * 0.2
        ctx.beginPath()
        ctx.fillStyle = `rgba(255, 0, 229, ${opacity * 0.3})`
        ctx.arc(particle.x, particle.y, 1, 0, Math.PI * 2)
        ctx.fill()
      })

      requestAnimationFrame(animate)
    }

    animate()

    const handleResize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} />
}
