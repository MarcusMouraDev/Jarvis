locals {
  name = "jarvis-hermes-oci"
}

resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.42.0.0/16"]
  display_name   = "${local.name}-vcn"
  dns_label      = "jarvis"
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  enabled        = true
  display_name   = "${local.name}-igw"
}

resource "oci_core_route_table" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

resource "oci_core_security_list" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }
  ingress_security_rules {
    source   = var.admin_cidr
    protocol = "6"
    tcp_options {
      min = 22
      max = 22
    }
  }
}

resource "oci_core_subnet" "main" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = "10.42.1.0/24"
  display_name               = "${local.name}-subnet"
  dns_label                  = "private"
  route_table_id             = oci_core_route_table.main.id
  security_list_ids          = [oci_core_security_list.main.id]
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_instance" "main" {
  availability_domain = var.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = local.name
  shape               = var.shape
  freeform_tags       = { profile = "oci-a1-free", managed = "opentofu" }
  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_in_gbs
  }
  create_vnic_details {
    subnet_id        = oci_core_subnet.main.id
    assign_public_ip = true
    hostname_label   = "jarvis"
  }
  source_details {
    source_type             = "image"
    source_id               = var.image_ocid
    boot_volume_size_in_gbs = 50
  }
  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data            = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", { tailscale_auth_key = var.tailscale_auth_key }))
  }
}

resource "oci_core_volume" "data" {
  availability_domain = var.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "${local.name}-data"
  size_in_gbs         = 100
  freeform_tags       = { profile = "oci-a1-free" }
}

resource "oci_core_volume_attachment" "data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.main.id
  volume_id       = oci_core_volume.data.id
}

output "instance_public_ip" { value = oci_core_instance.main.public_ip }
output "tailscale_note" { value = "Use Tailscale hostname after cloud-init; Jarvis, Hermes, and OmniRoute stay private." }
