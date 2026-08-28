variable "compartment_ocid" { type = string }
variable "region" { type = string }
variable "availability_domain" { type = string }
variable "image_ocid" { type = string }
variable "ssh_public_key" { type = string }
variable "tailscale_auth_key" { type = string, sensitive = true }
variable "admin_cidr" {
  type    = string
  default = "100.64.0.0/10"
}

variable "shape" {
  type    = string
  default = "VM.Standard.A1.Flex"
  validation {
    condition     = var.shape == "VM.Standard.A1.Flex"
    error_message = "oci-a1-free refuses paid or x86 shapes. Use VM.Standard.A1.Flex."
  }
}

variable "ocpus" {
  type    = number
  default = 2
  validation {
    condition     = var.ocpus > 0 && var.ocpus <= 2
    error_message = "Always Free A1 profile is capped at 2 OCPUs."
  }
}

variable "memory_in_gbs" {
  type    = number
  default = 12
  validation {
    condition     = var.memory_in_gbs > 0 && var.memory_in_gbs <= 12
    error_message = "Always Free A1 profile is capped at 12 GB RAM."
  }
}
